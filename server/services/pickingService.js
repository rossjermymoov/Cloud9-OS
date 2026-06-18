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
  for (const pi of invs) {
    items += num(pi.quantity_picked) || num(pi.quantity_to_pick);
    if (pi.order_summary_id != null) orders.add(String(pi.order_summary_id));
  }

  // Helm `duration` is ACTIVE time on each action, in SECONDS (decimals). Each
  // action also carries the user_id who performed it, and ITEM_SCAN actions carry
  // the quantity confirmed — so we split BOTH time and items per user.
  // A Helm "pick" is a WAVE; the true unit of picking work is a single ITEM_SCAN
  // (one scan of an item line). So alongside total handling time we track the
  // ITEM_SCAN duration + count — both overall and per user — to report a real
  // "average time per pick" (item_scan time ÷ number of item scans).
  const tt = Array.isArray(detail?.time_tracking_data) ? detail.time_tracking_data : [];
  let handlingSec = 0, itemScanSec = 0, itemScanCount = 0;
  const byUser = {};   // user_id -> { sec, items, scans, itemSec, itemScans }
  for (const t of tt) {
    const d = parseFloat(t.duration); const dur = isNaN(d) ? 0 : d;
    handlingSec += dur;
    const isItemScan = String(t.type || '').toUpperCase() === 'ITEM_SCAN';
    if (isItemScan) { itemScanSec += dur; itemScanCount += 1; }
    const uid = t.user_id != null ? String(t.user_id) : null;
    if (!uid) continue;
    const b = (byUser[uid] ||= { sec: 0, items: 0, scans: 0, itemSec: 0, itemScans: 0 });
    b.sec += dur; b.scans += 1;
    if (isItemScan) { b.itemSec += dur; b.itemScans += 1; }
    const q = parseInt(t.quantity);
    if (!isNaN(q) && q > 0) b.items += q;
  }
  const handlingMs    = Math.round(handlingSec * 1000);
  const itemScanMs    = Math.round(itemScanSec * 1000);

  // Build per-user contributions. If ITEM_SCAN quantities didn't account for all
  // picked items, credit the shortfall to whoever spent the most time.
  const contributions = Object.entries(byUser).map(([user_id, b]) => ({
    user_id, items: b.items, handlingMs: Math.round(b.sec * 1000), scans: b.scans,
    itemScanMs: Math.round(b.itemSec * 1000), itemScanCount: b.itemScans,
  }));
  const scannedItems = contributions.reduce((a, c) => a + c.items, 0);
  if (items > scannedItems && contributions.length) {
    const top = [...contributions].sort((a, b) => b.handlingMs - a.handlingMs)[0];
    top.items += (items - scannedItems);
  }

  // Primary picker = most items, then most time. Falls back to the assigned user
  // (or the per-line picked_by) when there's no time-tracking at all.
  let pickerId = null;
  if (contributions.length) {
    pickerId = [...contributions].sort((a, b) => (b.items - a.items) || (b.handlingMs - a.handlingMs))[0].user_id;
  } else {
    const assigned = header?.assigned_to ?? detail?.assigned_to
      ?? invs.find(pi => pi.picked_by != null)?.picked_by;
    pickerId = assigned != null ? String(assigned) : null;
  }

  // If a completed pick has NO per-scan timing, still credit its picker for the
  // items (with zero measured time) so they appear on the leaderboard — otherwise
  // pickers whose flow doesn't log scan timing (e.g. Mark Lewis) vanish entirely.
  if (contributions.length === 0 && pickerId) {
    contributions.push({ user_id: pickerId, items, handlingMs: 0, scans: 0, itemScanMs: 0, itemScanCount: 0 });
  }

  const created   = toDate(detail?.created_at || header?.created_at);
  const completed = toDate(detail?.completed_at || header?.completed_at);
  const elapsedMs = (created && completed) ? Math.max(0, completed.getTime() - created.getTime()) : 0;

  return { items, lineCount: invs.length, orderCount: orders.size, handlingMs, elapsedMs,
           itemScanMs, itemScanCount,
           pickerId, contributions, created, completed, orderIds: [...orders] };
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
                itemScanMs: 0, itemScanCount: 0,
                pickerId: h.assigned_to != null ? String(h.assigned_to) : null, contributions: [], orderIds: [],
                created: toDate(h.created_at), completed: toDate(h.completed_at) };

      // Only completed picks carry meaningful items/time — fetch detail for those.
      let rawToStore = h;
      if (status === 1) {
        try {
          const detail = await fetchPickDetail(pickId);
          s = summarisePick(detail, h);
          detailed++;
          // Keep the timing-relevant parts of the detail (NOT the huge order_data
          // blobs) so we can audit how time/items were derived.
          rawToStore = {
            header: h,
            assigned_to: detail?.assigned_to,
            created_at: detail?.created_at,
            completed_at: detail?.completed_at,
            time_tracking_data: detail?.time_tracking_data || null,
            pick_inventories: Array.isArray(detail?.pick_inventories)
              ? detail.pick_inventories.map(pi => ({
                  quantity_to_pick: pi.quantity_to_pick, quantity_picked: pi.quantity_picked,
                  picked_by: pi.picked_by, order_summary_id: pi.order_summary_id,
                  inventory_id: pi.inventory_id, location_id: pi.location_id,
                }))
              : null,
          };
          if (pickDelayMs) await sleep(pickDelayMs);
        } catch (e) { errors++; console.warn(`[picking-sync] detail ${pickId}: ${e.message}`); }
      }

      const pickerName = s.pickerId ? (userMap.get(s.pickerId) || `User ${s.pickerId}`) : null;
      const pickDate = (s.completed || s.created || null);
      const pickDateStr = pickDate ? pickDate.toISOString().slice(0, 10) : null;

      // label_at = when this pick's last order was dispatched (shipment label made).
      // Used to time bulk picks that have no scan timing (see gap pass below).
      let labelAt = null;
      if (s.orderIds && s.orderIds.length) {
        try {
          const lr = await query(`SELECT MAX(dispatched_at) AS m FROM orders WHERE helm_order_id = ANY($1)`, [s.orderIds]);
          labelAt = lr.rows[0]?.m || null;
        } catch { /* orders may not be loaded yet */ }
      }
      const timingSource = s.handlingMs > 0 ? 'scan' : null;

      try {
        await query(`
          INSERT INTO picks
            (helm_pick_id, pick_number, pick_type, pick_type_name, pick_option, pick_option_name,
             status, status_name, warehouse_id, created_by, picker_id, picker_name,
             item_count, line_count, order_count, handling_ms, elapsed_ms,
             is_batch, is_split, ui_pick, force_completed, helm_created_at, completed_at, pick_date, raw_payload, contributor_count, label_at, timing_source,
             item_scan_ms, item_scan_count)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
          ON CONFLICT (helm_pick_id) DO UPDATE SET
            pick_number=EXCLUDED.pick_number, pick_type=EXCLUDED.pick_type, pick_type_name=EXCLUDED.pick_type_name,
            pick_option=EXCLUDED.pick_option, pick_option_name=EXCLUDED.pick_option_name,
            status=EXCLUDED.status, status_name=EXCLUDED.status_name, warehouse_id=EXCLUDED.warehouse_id,
            created_by=EXCLUDED.created_by, picker_id=EXCLUDED.picker_id, picker_name=EXCLUDED.picker_name,
            item_count=EXCLUDED.item_count, line_count=EXCLUDED.line_count, order_count=EXCLUDED.order_count,
            -- Only overwrite timing when this sync actually measured scan time.
            -- Bulk picks come back with 0 (no scans); keep the previously gap-derived
            -- estimate instead of wiping it to 0 every sync — otherwise the headline
            -- average flickers whenever a read lands mid-sync (before the gap pass re-fills).
            handling_ms = CASE WHEN COALESCE(EXCLUDED.handling_ms,0) > 0 THEN EXCLUDED.handling_ms ELSE picks.handling_ms END,
            timing_source = CASE WHEN COALESCE(EXCLUDED.handling_ms,0) > 0 THEN EXCLUDED.timing_source ELSE picks.timing_source END,
            elapsed_ms=EXCLUDED.elapsed_ms,
            is_batch=EXCLUDED.is_batch, is_split=EXCLUDED.is_split, ui_pick=EXCLUDED.ui_pick,
            force_completed=EXCLUDED.force_completed, helm_created_at=EXCLUDED.helm_created_at,
            completed_at=EXCLUDED.completed_at, pick_date=EXCLUDED.pick_date,
            raw_payload=EXCLUDED.raw_payload, contributor_count=EXCLUDED.contributor_count,
            label_at=COALESCE(EXCLUDED.label_at, picks.label_at),
            item_scan_ms=EXCLUDED.item_scan_ms, item_scan_count=EXCLUDED.item_scan_count, updated_at=NOW()
        `, [
          pickId, h.pick_number || null, num(h.pick_type) || null, h.pick_type_name || TYPE_NAME[num(h.pick_type)] || null,
          num(h.pick_option) || null, h.pick_option_name || OPTION_NAME[num(h.pick_option)] || null,
          status, h.status_name || STATUS_NAME[status] || null, num(h.warehouse_id) || null,
          h.created_by != null ? String(h.created_by) : null, s.pickerId, pickerName,
          s.items, s.lineCount, s.orderCount, s.handlingMs, s.elapsedMs,
          h.is_batch === '1' || h.is_batch === 1, h.is_split === '1' || h.is_split === 1,
          h.ui_pick === '1' || h.ui_pick === 1, h.force_completed === '1' || h.force_completed === 1,
          s.created ? s.created.toISOString() : null, s.completed ? s.completed.toISOString() : null,
          pickDateStr, JSON.stringify(rawToStore).slice(0, 150000), s.contributions.length || 1,
          labelAt, timingSource, s.itemScanMs || 0, s.itemScanCount || 0,
        ]);
        stored++;

        // Replace this pick's per-user contributions (split time + items by picker).
        await query(`DELETE FROM pick_contributions WHERE helm_pick_id = $1`, [pickId]);
        for (const c of s.contributions) {
          const cName = userMap.get(c.user_id) || `User ${c.user_id}`;
          await query(`
            INSERT INTO pick_contributions (helm_pick_id, user_id, picker_name, items, handling_ms, scans, pick_date, warehouse_id, item_scan_ms, item_scan_count)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT (helm_pick_id, user_id) DO UPDATE SET
              picker_name=EXCLUDED.picker_name, items=EXCLUDED.items,
              handling_ms = CASE WHEN COALESCE(EXCLUDED.handling_ms,0) > 0 THEN EXCLUDED.handling_ms ELSE pick_contributions.handling_ms END,
              scans=EXCLUDED.scans, pick_date=EXCLUDED.pick_date, warehouse_id=EXCLUDED.warehouse_id,
              item_scan_ms=EXCLUDED.item_scan_ms, item_scan_count=EXCLUDED.item_scan_count, updated_at=NOW()
          `, [pickId, c.user_id, cName, c.items, c.handlingMs, c.scans, pickDateStr, num(h.warehouse_id) || null, c.itemScanMs || 0, c.itemScanCount || 0]);
        }
      } catch (e) { errors++; console.warn(`[picking-sync] upsert ${pickId}: ${e.message}`); }
    }

    // ── Gap timing for bulk picks (no scan timing) ────────────────────────────
    // Time each untimed pick by the gap to the picker's previous pick (using the
    // order's label/dispatch time), excluding idle gaps over 60 min. Then mirror
    // the derived time onto its contribution so the leaderboard picks it up.
    const fromDay = from.toISOString().slice(0, 10);
    let gapped = 0;
    try {
      const g = await query(`
        WITH ordered AS (
          SELECT helm_pick_id, picker_id, label_at,
                 LAG(label_at) OVER (PARTITION BY picker_id ORDER BY label_at) AS prev
          FROM picks
          WHERE status = 1 AND COALESCE(handling_ms,0) = 0 AND label_at IS NOT NULL
            AND pick_date >= $1
        )
        UPDATE picks p
           SET handling_ms = EXTRACT(EPOCH FROM (o.label_at - o.prev)) * 1000,
               timing_source = 'gap', updated_at = NOW()
          FROM ordered o
         WHERE p.helm_pick_id = o.helm_pick_id
           AND o.prev IS NOT NULL
           AND (o.label_at - o.prev) > interval '0 minutes'
           AND (o.label_at - o.prev) <= interval '60 minutes'
        RETURNING p.helm_pick_id`, [fromDay]);
      gapped = g.rows.length;
      // Mirror the derived handling time onto each pick's (single) contribution.
      if (gapped) {
        await query(`
          UPDATE pick_contributions c
             SET handling_ms = p.handling_ms, updated_at = NOW()
            FROM picks p
           WHERE c.helm_pick_id = p.helm_pick_id AND p.timing_source = 'gap'
             AND p.pick_date >= $1`, [fromDay]);
      }
    } catch (e) { console.warn('[picking-sync] gap pass:', e.message); }

    const detail = `${stored} picks (${detailed} detailed), ${gapped} gap-timed, ${errors} errors, ${userMap.size} users`;
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
