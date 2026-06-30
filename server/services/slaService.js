/**
 * Cloud9 OS — On-time dispatch SLA
 *
 * Rule: an order received BEFORE its customer's cutoff (default 14:00, London)
 * on a working day must dispatch THAT day. Received after cutoff, or on a
 * weekend / bank holiday, it rolls to the next working day.
 *
 *   on_time        — dispatched on/before the due working day
 *   breach_late    — dispatched AFTER the due working day
 *   breach_overdue — not dispatched and the due day is already in the past
 *   pending        — not dispatched yet, still within SLA
 */

import { query } from '../db/index.js';
import { helmConfigured, fetchOrdersForClient, fetchOrdersUpdatedRange } from './helmClient.js';
import { pickParcelCount } from './volumeService.js';
import { holidaySet, isWorkingDay, firstWorkingAfter } from './bankHolidayService.js';

function cleanDate(d) { if (!d) return null; const s = String(d); return s.startsWith('0000') ? null : s; }

/**
 * Wall-clock calendar day + minutes-since-midnight for a Helm timestamp.
 * Helm sends LONDON local wall-clock (e.g. '2026-06-16 13:38:19') with no zone.
 * Those land in TIMESTAMPTZ as that wall-clock stored against UTC, so we read
 * the components back as-is (string → parse directly; Date → UTC getters) and
 * do NOT re-convert through a timezone (which previously shifted by the BST
 * offset and pushed pre-cutoff orders over the line).
 */
function wallClock(input) {
  if (input == null) return null;
  if (input instanceof Date) {
    if (isNaN(input.getTime())) return null;
    return { ymd: input.toISOString().slice(0, 10), minutes: input.getUTCHours() * 60 + input.getUTCMinutes() };
  }
  const s = String(input).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (m) return { ymd: `${m[1]}-${m[2]}-${m[3]}`, minutes: parseInt(m[4], 10) * 60 + parseInt(m[5], 10) };
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return { ymd: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

// Current London calendar date (now() is a true instant, so this is a real convert).
export function todayLondonYmd() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function cutoffMinutes(cutoff) {
  if (!cutoff) return 14 * 60;
  const [h, m] = String(cutoff).split(':');
  return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
}

/** Due working day (YYYY-MM-DD) for an order received at `receivedAt`. */
export function dueDateFor(receivedAt, cutoff, hs) {
  const lp = wallClock(receivedAt);
  if (!lp) return null;
  if (isWorkingDay(lp.ymd, hs) && lp.minutes <= cutoffMinutes(cutoff)) return lp.ymd;
  return firstWorkingAfter(lp.ymd, hs);
}

/** Classify one order row ({ received_at, dispatched_at, cutoff_time }). */
export function classifyOrder(order, hs, todayYmd) {
  if (!order.received_at) return { sla_status: 'unknown', due: null };
  const due = dueDateFor(order.received_at, order.cutoff_time, hs);
  if (order.dispatched_at) {
    const dl = wallClock(order.dispatched_at);
    const dispYmd = dl ? dl.ymd : null;
    return { due, dispatched_ymd: dispYmd, sla_status: (dispYmd && dispYmd <= due) ? 'on_time' : 'breach_late' };
  }
  if (due && due < todayYmd) return { due, sla_status: 'breach_overdue' };
  return { due, sla_status: 'pending' };
}

/**
 * Pull all orders received in the last `days` for every customer with a Helm id,
 * upserting received/dispatched times + status so the SLA can be evaluated.
 */
export async function syncRecentOrders(days = 14) {
  if (!helmConfigured()) return { error: 'Helm not configured' };
  const to = new Date(), from = new Date(Date.now() - days * 86400000);

  let logId = null;
  try {
    const lr = await query(
      `INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('sla_orders','running',0,$1) RETURNING id`,
      [`started ${days}d order sync at ${new Date().toISOString()}`]
    );
    logId = lr.rows[0]?.id || null;
  } catch (e) { console.warn('[sla-sync] start row failed:', e.message); }

  let stored = 0, custCount = 0, errors = 0;
  try {
    const cm = await query(`SELECT id, helm_customer_id FROM customers WHERE helm_customer_id IS NOT NULL`);
    for (const c of cm.rows) {
      try {
        const orders = await fetchOrdersForClient({ helmClientId: c.helm_customer_id, from, to });
        for (const raw of orders) {
          const o = raw.order || raw;
          const helmOrderId = o.id != null ? String(o.id) : null;
          if (!helmOrderId) continue;
          const received = cleanDate(o.date_received ?? o.received_at);
          const dispatched = cleanDate(o.date_dispatched ?? o.dispatched_at);
          const statusId = o.status_id != null ? parseInt(o.status_id) : null;
          const parcels = pickParcelCount(o) || 0;
          const items = parseInt(o.total_inventory_quantity ?? o.item_quantity ?? o.items) || 0;
          await query(`
            INSERT INTO orders
              (helm_order_id, channel_order_id, customer_id, helm_client_id, status_id, status_label,
               item_count, parcel_count, received_at, dispatched_at, raw_payload)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            ON CONFLICT (helm_order_id) DO UPDATE SET
              customer_id   = COALESCE(EXCLUDED.customer_id, orders.customer_id),
              status_id     = EXCLUDED.status_id,
              status_label  = EXCLUDED.status_label,
              item_count    = EXCLUDED.item_count,
              parcel_count  = GREATEST(EXCLUDED.parcel_count, orders.parcel_count),
              received_at   = COALESCE(EXCLUDED.received_at, orders.received_at),
              dispatched_at = COALESCE(EXCLUDED.dispatched_at, orders.dispatched_at),
              updated_at    = NOW()
          `, [
            helmOrderId, o.channel_order_id || null, c.id, String(c.helm_customer_id),
            statusId, o.status || o.status_label || null, items, parcels,
            received, dispatched, JSON.stringify(o).slice(0, 60000),
          ]);
          stored++;
        }
        custCount++;
      } catch (e) { errors++; console.warn(`[sla-sync] client ${c.helm_customer_id}: ${e.message}`); }
    }
    const detail = `${stored} orders across ${custCount} customers, ${errors} errors`;
    if (logId) await query(`UPDATE helm_sync_log SET status='ok', records=$1, detail=$2, ran_at=NOW() WHERE id=$3`, [stored, detail, logId]);
    else await query(`INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('sla_orders','ok',$1,$2)`, [stored, detail]);
    console.log('✅ SLA order sync complete:', detail);
    return { stored, customers: custCount, errors };
  } catch (err) {
    const msg = `${err.message} (stored ${stored})`;
    if (logId) await query(`UPDATE helm_sync_log SET status='error', records=$1, detail=$2, ran_at=NOW() WHERE id=$3`, [stored, msg, logId]).catch(() => {});
    return { stored, error: err.message };
  }
}

/**
 * Lightweight, frequent sync of order STATUS across all clients (for the live
 * warehouse pipeline: Picking / Packing / Despatch Ready). Pulls orders updated
 * in the last `days` (any status) and upserts status_id + timestamps, attributing
 * via fulfilment_client_id. No per-client loop, no snapshot recompute.
 */
export async function syncOrderStatuses(days = 1) {
  if (!helmConfigured()) return { error: 'Helm not configured' };
  const to = new Date(), from = new Date(Date.now() - days * 86400000);
  const cm = await query(`SELECT id, helm_customer_id FROM customers WHERE helm_customer_id IS NOT NULL`);
  const byClient = new Map(cm.rows.map(r => [String(r.helm_customer_id), r.id]));

  let stored = 0;
  try {
    const orders = await fetchOrdersUpdatedRange({ from, to });
    for (const raw of orders) {
      const o = raw.order || raw;
      const helmOrderId = o.id != null ? String(o.id) : null;
      if (!helmOrderId) continue;
      const clientId = o.fulfilment_client_id != null ? String(o.fulfilment_client_id) : null;
      const customerId = clientId ? (byClient.get(clientId) || null) : null;
      const statusId = o.status_id != null ? parseInt(o.status_id) : null;
      // Helm sends the full status object on the order. Capture its definition
      // (incl. the "dashboard" visibility flag + colour) so the Status Board can
      // render a card per dashboard-visible status. status may be an object or a name.
      const so = (o.status && typeof o.status === 'object') ? o.status : null;
      const statusName = so ? (so.status || so.name) : (typeof o.status === 'string' ? o.status : o.status_label);
      if (so && so.id != null) {
        await query(`
          INSERT INTO helm_order_statuses (status_id, name, dashboard, colour, text_colour, sort, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,NOW())
          ON CONFLICT (status_id) DO UPDATE SET
            name=EXCLUDED.name, dashboard=EXCLUDED.dashboard, colour=EXCLUDED.colour,
            text_colour=EXCLUDED.text_colour, sort=EXCLUDED.sort, updated_at=NOW()
        `, [parseInt(so.id), so.status || so.name || null,
            so.dashboard === 1 || so.dashboard === true || so.dashboard === '1',
            so.status_colour || null, so.status_text_colour || null,
            so.sort != null ? parseInt(so.sort) : null]).catch(() => {});
      }
      const received = cleanDate(o.date_received ?? o.created_at);
      const dispatched = cleanDate(o.date_dispatched);
      const parcels = pickParcelCount(o) || 0;
      const items = parseInt(o.total_inventory_quantity ?? o.item_quantity ?? o.items) || 0;
      await query(`
        INSERT INTO orders
          (helm_order_id, channel_order_id, customer_id, helm_client_id, status_id, status_label,
           item_count, parcel_count, received_at, dispatched_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (helm_order_id) DO UPDATE SET
          customer_id   = COALESCE(EXCLUDED.customer_id, orders.customer_id),
          helm_client_id= COALESCE(EXCLUDED.helm_client_id, orders.helm_client_id),
          status_id     = EXCLUDED.status_id,
          status_label  = EXCLUDED.status_label,
          item_count    = EXCLUDED.item_count,
          parcel_count  = GREATEST(EXCLUDED.parcel_count, orders.parcel_count),
          received_at   = COALESCE(EXCLUDED.received_at, orders.received_at),
          dispatched_at = COALESCE(EXCLUDED.dispatched_at, orders.dispatched_at),
          updated_at    = NOW()
      `, [helmOrderId, o.channel_order_id || null, customerId, clientId, statusId,
          statusName || null, items, parcels, received, dispatched]);
      stored++;
    }
    return { stored };
  } catch (err) {
    console.warn('[order-status-sync]', err.message);
    return { stored, error: err.message };
  }
}

/**
 * Evaluate orders received within [fromYmd, toYmd] and return classified rows
 * plus summary counts. `hs` is loaded once and reused.
 */
export async function evaluateOrders({ fromYmd, toYmd, customerId = null }) {
  const hs = await holidaySet();
  const today = todayLondonYmd();
  const vals = [`${fromYmd} 00:00:00`, `${toYmd} 23:59:59`];
  // Exclude cancelled orders, plus parked statuses that aren't a live commitment:
  //   1    Draft           — not a committed order yet
  //   3019 Beddoes Review  — held for review, not an active dispatch obligation
  // Neither should ever count as a breach even if it sits past its due date.
  let where = `o.received_at IS NOT NULL AND o.received_at >= $1 AND o.received_at <= $2
               AND (o.status_label IS NULL OR o.status_label NOT ILIKE '%cancel%')
               AND (o.status_id IS NULL OR o.status_id NOT IN (1, 3019))`;
  if (customerId) { vals.push(customerId); where += ` AND o.customer_id = $${vals.length}`; }

  const { rows } = await query(`
    SELECT o.id, o.helm_order_id, o.channel_order_id, o.customer_id, o.received_at, o.dispatched_at,
           o.parcel_count, o.item_count, o.status_label, o.status_id, c.business_name, c.cutoff_time
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE ${where}
    ORDER BY o.received_at DESC
  `, vals);

  const evaluated = rows.map(r => ({ ...r, ...classifyOrder(r, hs, today) }));
  const counts = { on_time: 0, breach_late: 0, breach_overdue: 0, pending: 0, unknown: 0 };
  for (const r of evaluated) counts[r.sla_status] = (counts[r.sla_status] || 0) + 1;
  const breaches = counts.breach_late + counts.breach_overdue;
  const resolved = counts.on_time + breaches;           // orders whose SLA outcome is known
  const on_time_pct = resolved > 0 ? Math.round((counts.on_time / resolved) * 1000) / 10 : null;

  return { today, counts, breaches, resolved, on_time_pct, rows: evaluated };
}
