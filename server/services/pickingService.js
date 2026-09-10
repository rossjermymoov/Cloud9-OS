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
  const d = detail?.data || detail || {};
  const invs = Array.isArray(d.pick_inventories)
    ? d.pick_inventories
    : (Array.isArray(d.inventories) ? d.inventories : (Array.isArray(d.items) ? d.items : []));
  const orderData = Array.isArray(d.order_data)
    ? d.order_data
    : (Array.isArray(d.orders) ? d.orders : []);

  let items = 0;
  const orders = new Set();
  for (const pi of invs) {
    items += num(pi.quantity_picked) || num(pi.quantity_to_pick) || num(pi.quantity) || num(pi.qty) || num(pi.total_quantity) || 0;
    if (pi.order_summary_id != null) orders.add(String(pi.order_summary_id));
    if (pi.order_id != null) orders.add(String(pi.order_id));
  }

  // If pick_inventories was empty or 0 items, derive from order_data
  for (const o of orderData) {
    const oId = o.id || o.order_summary_id || o.order_id || o.channel_order_id;
    if (oId != null) orders.add(String(oId));
    if (invs.length === 0 || items === 0) {
      const orderInvs = Array.isArray(o.order_inventories) ? o.order_inventories : (Array.isArray(o.order_items) ? o.order_items : (Array.isArray(o.items) ? o.items : []));
      if (orderInvs.length > 0) {
        for (const oi of orderInvs) {
          items += num(oi.quantity_picked) || num(oi.quantity_to_pick) || num(oi.quantity) || num(oi.qty) || 0;
        }
      } else {
        items += num(o.total_inventory_quantity) || num(o.quantity) || num(o.total_items) || 0;
      }
    }
  }

  // Helm `duration` is ACTIVE time on each action, in SECONDS (decimals). Each
  // action also carries the user_id who performed it, and ITEM_SCAN actions carry
  // the quantity confirmed — so we split BOTH time and items per user.
  // A Helm "pick" is a WAVE; the true unit of picking work is a single ITEM_SCAN
  // (one scan of an item line). So alongside total handling time we track the
  // ITEM_SCAN duration + count — both overall and per user — to report a real
  // "average time per pick" (item_scan time ÷ number of item scans).
  const tt = Array.isArray(d.time_tracking_data) ? d.time_tracking_data : [];
  let handlingSec = 0, itemScanSec = 0, itemScanCount = 0;
  const byUser = {};   // user_id -> { sec, items, scans, itemSec, itemScans }
  for (const t of tt) {
    const durVal = parseFloat(t.duration); const dur = isNaN(durVal) ? 0 : durVal;
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
    const assigned = header?.assigned_to ?? d.assigned_to
      ?? invs.find(pi => pi.picked_by != null)?.picked_by;
    pickerId = assigned != null ? String(assigned) : null;
  }

  // If a completed pick has NO per-scan timing, still credit its picker for the
  // items (with zero measured time) so they appear on the leaderboard — otherwise
  // pickers whose flow doesn't log scan timing (e.g. Mark Lewis) vanish entirely.
  if (contributions.length === 0 && pickerId) {
    contributions.push({ user_id: pickerId, items, handlingMs: 0, scans: 0, itemScanMs: 0, itemScanCount: 0 });
  }

  const created   = toDate(d.created_at || header?.created_at);
  const completed = toDate(d.completed_at || header?.completed_at);
  const elapsedMs = (created && completed) ? Math.max(0, completed.getTime() - created.getTime()) : 0;

  return { items, lineCount: invs.length || orderData.length, orderCount: orders.size, handlingMs, elapsedMs,
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
          const rawDetailPayload = detail?.data || detail || {};
          rawToStore = {
            header: h,
            assigned_to: rawDetailPayload?.assigned_to,
            created_at: rawDetailPayload?.created_at,
            completed_at: rawDetailPayload?.completed_at,
            time_tracking_data: rawDetailPayload?.time_tracking_data || null,
            pick_inventories: Array.isArray(rawDetailPayload?.pick_inventories)
              ? rawDetailPayload.pick_inventories.map(pi => ({
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

/**
 * Fetch and format pick breakdown: full list of orders and items for this wave.
 * Queries Helm API directly for full detail and updates the stored database record if needed.
 */
export async function getPickBreakdown(pickIdOrNumber) {
  if (!helmConfigured()) throw new Error('Helm API not configured');

  // Look up pick in DB first to get helm_pick_id and existing metadata
  let helmPickId = String(pickIdOrNumber);
  let dbPick = null;
  try {
    const { rows } = await query(
      `SELECT * FROM picks WHERE helm_pick_id = $1 OR pick_number = $1 LIMIT 1`,
      [pickIdOrNumber]
    );
    if (rows.length) {
      dbPick = rows[0];
      helmPickId = dbPick.helm_pick_id;
    }
  } catch (err) {
    console.warn('[getPickBreakdown] DB lookup error:', err.message);
  }

  // Fetch from Helm API
  const rawDetail = await fetchPickDetail(helmPickId);
  const d = rawDetail?.data || rawDetail || {};

  // Extract Orders
  const rawOrders = Array.isArray(d.order_data)
    ? d.order_data
    : (Array.isArray(d.orders) ? d.orders : []);

  const orders = rawOrders.map(o => {
    const oInvs = Array.isArray(o.order_inventories) ? o.order_inventories : (Array.isArray(o.order_items) ? o.order_items : (Array.isArray(o.items) ? o.items : []));
    const itemsCount = o.total_inventory_quantity != null
      ? num(o.total_inventory_quantity)
      : (oInvs.length > 0 ? oInvs.reduce((acc, x) => acc + (num(x.quantity) || num(x.quantity_picked) || num(x.quantity_to_pick) || 1), 0) : 1);

    return {
      order_id: o.id != null ? String(o.id) : (o.order_summary_id != null ? String(o.order_summary_id) : null),
      channel_order_id: o.channel_order_id || o.channel_order_number || o.order_number || o.reference || (o.id ? `Order #${o.id}` : 'Order'),
      invoice_number: o.invoice_number || null,
      customer_name: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ') || o.customer_name || o.shipping_contact_name || o.delivery_name || o.contact_name || null,
      status: o.status || o.status_name || o.status_label || null,
      item_count: itemsCount,
      shipping_method: o.shipping_method || o.courier_service_name || o.delivery_method || null,
    };
  });

  // Extract Items
  const rawInvs = Array.isArray(d.pick_inventories)
    ? d.pick_inventories
    : (Array.isArray(d.inventories) ? d.inventories : (Array.isArray(d.items) ? d.items : []));

  let items = [];
  if (rawInvs.length > 0) {
    items = rawInvs.map(pi => {
      const qtyToPick = num(pi.quantity_to_pick) || num(pi.quantity) || num(pi.qty) || num(pi.quantity_picked) || 0;
      const qtyPicked = pi.quantity_picked != null ? num(pi.quantity_picked) : qtyToPick;
      return {
        id: pi.id || pi.inventory_id || null,
        sku: pi.sku || pi.product_sku || pi.inventory_sku || pi.inventory?.sku || pi.code || '—',
        product_name: pi.name || pi.product_name || pi.inventory_name || pi.inventory?.name || pi.description || 'Item',
        barcode: pi.barcode || pi.inventory?.barcode || null,
        location: pi.location_name || pi.location?.name || pi.bin || pi.location_code || (pi.location_id ? `Location ${pi.location_id}` : '—'),
        quantity_to_pick: qtyToPick,
        quantity_picked: qtyPicked,
        order_summary_id: pi.order_summary_id != null ? String(pi.order_summary_id) : null,
        picked_by: pi.picked_by != null ? String(pi.picked_by) : null,
      };
    });
  } else if (rawOrders.length > 0) {
    // Flatten from order_data
    for (const o of rawOrders) {
      const oInvs = Array.isArray(o.order_inventories) ? o.order_inventories : (Array.isArray(o.order_items) ? o.order_items : (Array.isArray(o.items) ? o.items : []));
      for (const oi of oInvs) {
        const qtyToPick = num(oi.quantity_to_pick) || num(oi.quantity) || num(oi.qty) || num(oi.quantity_picked) || 1;
        const qtyPicked = oi.quantity_picked != null ? num(oi.quantity_picked) : qtyToPick;
        items.push({
          id: oi.id || oi.inventory_id || null,
          sku: oi.sku || oi.product_sku || oi.inventory_sku || oi.inventory?.sku || oi.code || '—',
          product_name: oi.name || oi.product_name || oi.inventory_name || oi.inventory?.name || oi.title || oi.description || 'Item',
          barcode: oi.barcode || oi.inventory?.barcode || null,
          location: oi.location_name || oi.location?.name || oi.bin || oi.location_code || (oi.location_id ? `Location ${oi.location_id}` : '—'),
          quantity_to_pick: qtyToPick,
          quantity_picked: qtyPicked,
          order_summary_id: o.id != null ? String(o.id) : (o.order_summary_id != null ? String(o.order_summary_id) : null),
          channel_order_id: o.channel_order_id || o.channel_order_number || o.order_number || null,
        });
      }
    }
  }

  const totalItemsCount = items.reduce((acc, it) => acc + (it.quantity_picked || it.quantity_to_pick || 0), 0)
    || orders.reduce((acc, o) => acc + (o.item_count || 0), 0)
    || num(d.total_items) || num(d.total_inventory_quantity) || 0;

  // Self-heal DB if DB had 0 or mismatched items
  if (dbPick && totalItemsCount > 0 && (dbPick.item_count === 0 || dbPick.item_count !== totalItemsCount)) {
    try {
      await query(
        `UPDATE picks SET item_count = $1, line_count = $2, order_count = $3, updated_at = NOW() WHERE helm_pick_id = $4`,
        [totalItemsCount, items.length || rawOrders.length, orders.length || dbPick.order_count, helmPickId]
      );
    } catch (e) {
      console.warn('[getPickBreakdown] DB self-heal update error:', e.message);
    }
  }

  return {
    pick_id: helmPickId,
    pick_number: d.pick_number || dbPick?.pick_number || helmPickId,
    status_name: d.status_name || dbPick?.status_name || null,
    pick_type_name: d.pick_type_name || dbPick?.pick_type_name || null,
    pick_option_name: d.pick_option_name || dbPick?.pick_option_name || null,
    total_items: totalItemsCount,
    total_orders: orders.length || (dbPick?.order_count || 0),
    orders,
    items,
  };
}
