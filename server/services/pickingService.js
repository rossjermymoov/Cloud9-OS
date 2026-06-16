/**
 * Cloud9 OS — Picking service
 *
 * Pulls Helm picks (List Picks + Get Pick Detail) into the `picks` table so the
 * Picking dashboard can report picks/day, items per pick, time per pick and
 * picker performance. Pull-only — mirrors the PO sync pattern.
 *
 * Per pick we compute:
 *   item_count  = Σ quantity_picked (fallback quantity_to_pick) across pick_inventories
 *   line_count  = number of pick_inventories
 *   order_count = distinct order_summary_id
 *   handling_ms = Σ time_tracking_data[].duration   (active handling time)
 *   elapsed_ms  = completed_at − created_at          (wall-clock)
 *   picker      = assigned_to, else most common picked_by / time-tracking user_id
 */

import { query } from '../db/index.js';
import { fetchUsers, fetchPicks, fetchPickDetail, helmConfigured } from './helmClient.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const TYPE_NAME   = { 1: 'Single', 2: 'Multi' };
const OPTION_NAME = { 1: 'Order by Order', 2: 'Bulk and Sort', 3: 'Tote', 4: 'Bulk' };
const STATUS_NAME = { 0: 'OPEN', 1: 'COMPLETED', 2: 'CANCELLED', 3: 'INPROGRESS', 4: 'IDLE' };

function toDate(v) {
  if (!v) return null;
  const s = String(v).replace(' ', 'T');
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function num(v) { const n = parseInt(v); return isNaN(n) ? 0 : n; }

/** Refresh the warehouse-user name map. Returns Map<helm_user_id, name>. */
export async function syncUsers() {
  const users = await fetchUsers();
  const map = new Map();
  for (const u of users) {
    const id = u.id != null ? String(u.id) : null;
    if (!id) continue;
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
      || u.name || u.full_name || u.username || u.email || `User ${id}`;
    map.set(id, name);
    await query(`
      INSERT INTO helm_users (helm_user_id, name, email, role, active, raw_payload)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (helm_user_id) DO UPDATE SET
        name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role,
        active = EXCLUDED.active, raw_payload = EXCLUDED.raw_payload, updated_at = NOW()
    `, [id, name, u.email || null, u.role || u.role_name || null,
        u.status == null ? true : (u.status === 1 || u.status === true || u.active === true),
        JSON.stringify(u).slice(0, 50000)]);
  }
  return map;
}

/** Reduce a pick detail body into the metrics we store. */
function summarisePick(detail, header) {
  const invs = Array.isArray(detail?.pick_inventories) ? detail.pick_inventories : [];
  let items = 0;
  const orders = new Set();
  const pickerVotes = {};
  for (const pi of invs) {
    const picked = num(pi.quantity_picked) || num(pi.quantity_to_pick);
    items += picked;
    if (pi.order_summary_id != null) orders.add(String(pi.order_summary_id));
    if (pi.picked_by != null) pickerVotes[String(pi.picked_by)] = (pickerVotes[String(pi.picked_by)] || 0) + 1;
  }

  const tt = Array.isArray(detail?.time_tracking_data) ? detail.time_tracking_data : [];
  let handlingMs = 0;
  for (const t of tt) {
    handlingMs += num(t.duration);
    if (t.user_id != null) pickerVotes[String(t.user_id)] = (pickerVotes[String(t.user_id)] || 0) + 1;
  }

  // Picker: explicit assignment wins; otherwise whoever did the most lines/scans.
  let pickerId = (header?.assigned_to ?? detail?.assigned_to);
  pickerId = pickerId != null ? String(pickerId) : null;
  if (!pickerId) {
    const top = Object.entries(pickerVotes).sort((a, b) => b[1] - a[1])[0];
    if (top) pickerId = top[0];
  }

  const created   = toDate(detail?.created_at || header?.created_at);
  const completed = toDate(detail?.completed_at || header?.completed_at);
  const elapsedMs = (created && completed) ? Math.max(0, completed.getTime() - created.getTime()) : 0;

  return { items, lineCount: invs.length, orderCount: orders.size, handlingMs, elapsedMs, pickerId, created, completed };
}

/**
 * Sync picks created within the last `days`. Fetches detail (items + time) only
 * for COMPLETED picks; open/in-progress picks are stored as headers. Logs a
 * 'running' row immediately so the job is always visible, like the Voila backfill.
 */
export async function syncPicks(days = 30, { pickDelayMs = 0 } = {}) {
  if (!helmConfigured()) return { error: 'Helm not configured' };
  const to = new Date();
  // Pull a slightly wider window than requested so picks created just before the
  // window but completed inside it are still captured (we bucket by completion).
  const from = new Date(Date.now() - (days + 2) * 86400000);

  let logId = null;
  try {
    const lr = await query(
      `INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('picking','running',0,$1) RETURNING id`,
      [`started ${days}d pick sync at ${new Date().toISOString()}`]
    );
    logId = lr.rows[0]?.id || null;
  } catch (e) { console.warn('[picking-sync] start row failed:', e.message); }

  let stored = 0, detailed = 0, errors = 0;
  try {
    const userMap = await syncUsers().catch(e => { console.warn('[picking-sync] users:', e.message); return new Map(); });

    const headers = await fetchPicks({ from, to, perPage: 100 });
    for (const h of headers) {
      const pickId = h.id != null ? String(h.id) : null;
      if (!pickId) continue;
      const status = num(h.status);

      let s = { items: 0, lineCount: 0, orderCount: 0, handlingMs: 0, elapsedMs: 0,
                pickerId: h.assigned_to != null ? String(h.assigned_to) : null,
                created: toDate(h.created_at), completed: toDate(h.completed_at) };

      // Only completed picks carry meaningful items/time — fetch detail for those.
      if (status === 1) {
        try {
          const detail = await fetchPickDetail(pickId);
          s = summarisePick(detail, h);
          detailed++;
          if (pickDelayMs) await sleep(pickDelayMs);
        } catch (e) { errors++; console.warn(`[picking-sync] detail ${pickId}: ${e.message}`); }
      }

      const pickerName = s.pickerId ? (userMap.get(s.pickerId) || `User ${s.pickerId}`) : null;
      const pickDate = (s.completed || s.created || null);
      const pickDateStr = pickDate ? pickDate.toISOString().slice(0, 10) : null;

      try {
        await query(`
          INSERT INTO picks
            (helm_pick_id, pick_number, pick_type, pick_type_name, pick_option, pick_option_name,
             status, status_name, warehouse_id, created_by, picker_id, picker_name,
             item_count, line_count, order_count, handling_ms, elapsed_ms,
             is_batch, is_split, ui_pick, force_completed, helm_created_at, completed_at, pick_date, raw_payload)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
          ON CONFLICT (helm_pick_id) DO UPDATE SET
            pick_number=EXCLUDED.pick_number, pick_type=EXCLUDED.pick_type, pick_type_name=EXCLUDED.pick_type_name,
            pick_option=EXCLUDED.pick_option, pick_option_name=EXCLUDED.pick_option_name,
            status=EXCLUDED.status, status_name=EXCLUDED.status_name, warehouse_id=EXCLUDED.warehouse_id,
            created_by=EXCLUDED.created_by, picker_id=EXCLUDED.picker_id, picker_name=EXCLUDED.picker_name,
            item_count=EXCLUDED.item_count, line_count=EXCLUDED.line_count, order_count=EXCLUDED.order_count,
            handling_ms=EXCLUDED.handling_ms, elapsed_ms=EXCLUDED.elapsed_ms,
            is_batch=EXCLUDED.is_batch, is_split=EXCLUDED.is_split, ui_pick=EXCLUDED.ui_pick,
            force_completed=EXCLUDED.force_completed, helm_created_at=EXCLUDED.helm_created_at,
            completed_at=EXCLUDED.completed_at, pick_date=EXCLUDED.pick_date,
            raw_payload=EXCLUDED.raw_payload, updated_at=NOW()
        `, [
          pickId, h.pick_number || null, num(h.pick_type) || null, h.pick_type_name || TYPE_NAME[num(h.pick_type)] || null,
          num(h.pick_option) || null, h.pick_option_name || OPTION_NAME[num(h.pick_option)] || null,
          status, h.status_name || STATUS_NAME[status] || null, num(h.warehouse_id) || null,
          h.created_by != null ? String(h.created_by) : null, s.pickerId, pickerName,
          s.items, s.lineCount, s.orderCount, s.handlingMs, s.elapsedMs,
          h.is_batch === '1' || h.is_batch === 1, h.is_split === '1' || h.is_split === 1,
          h.ui_pick === '1' || h.ui_pick === 1, h.force_completed === '1' || h.force_completed === 1,
          s.created ? s.created.toISOString() : null, s.completed ? s.completed.toISOString() : null,
          pickDateStr, JSON.stringify(h).slice(0, 100000),
        ]);
        stored++;
      } catch (e) { errors++; console.warn(`[picking-sync] upsert ${pickId}: ${e.message}`); }
    }

    const detail = `${stored} picks (${detailed} detailed), ${errors} errors, ${userMap.size} users`;
    if (logId) await query(`UPDATE helm_sync_log SET status='ok', records=$1, detail=$2, ran_at=NOW() WHERE id=$3`, [stored, detail, logId]);
    else await query(`INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('picking','ok',$1,$2)`, [stored, detail]);
    console.log('✅ picking sync complete:', detail);
    return { stored, detailed, errors };
  } catch (err) {
    console.error('❌ picking sync error:', err.message);
    const msg = `${err.message} (stored ${stored} before failing)`;
    if (logId) await query(`UPDATE helm_sync_log SET status='error', records=$1, detail=$2, ran_at=NOW() WHERE id=$3`, [stored, msg, logId]).catch(() => {});
    else await query(`INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('picking','error',$1,$2)`, [stored, msg]).catch(() => {});
    return { stored, error: err.message };
  }
}
