/**
 * Cloud9 OS — Warehouse TV board (PUBLIC, read-only)
 *
 * GET /api/warehouse/board — aggregate operational stats for a wall-mounted TV.
 * Deliberately unauthenticated and exposes only counts (no record-level PII
 * beyond customer names on the urgent list). Mounted OUTSIDE requireAuth.
 *
 * Breach proximity reads EACH customer's own cutoff: for orders due today and
 * not yet dispatched, colour by minutes remaining to that cutoff —
 *   green  > 2h   |   amber 1–2h   |   red < 1h   |   breached past cutoff.
 */

import express from 'express';
import { query } from '../db/index.js';
import { dueDateFor, todayLondonYmd } from '../services/slaService.js';
import { holidaySet } from '../services/bankHolidayService.js';
import { helmConfigured } from '../services/helmClient.js';

const router = express.Router();

// Optional URL key — set WAREHOUSE_KEY in Railway to lock the board to
// /warehouse?key=<value>. If unset, the board stays open (logs a warning).
const BOARD_KEY = process.env.WAREHOUSE_KEY || null;
if (!BOARD_KEY) console.warn('⚠️  WAREHOUSE_KEY not set — the warehouse board is open to anyone with the URL.');

// Helm order status_id groups (from the 3.6 spec).
const ST_PICKING       = [4, 2990];            // Picking, Partially Picked
const ST_PACKING       = [8, 10];              // Packing, Picked (scanned, awaiting dispatch)
const ST_DISPATCH_READY = [3, 2700, 82, 2711]; // Despatch Ready, Despatch Pending, Printed, Sorted

// Parked / non-actionable statuses to EXCLUDE from "should ship today" + breaches.
//   1 Draft · 3002 Service · 3010 Replenishment Needed · 3015 Supervisor · 3019 Beddoes Review
const ST_IGNORE = [1, 3002, 3010, 3015, 3019];

// Friendly display labels for the by-status breakdown (override Helm's name).
const STATUS_LABELS = { 26: 'Importing from Neuro' };

// Held / attention statuses to monitor with an ageing breakdown.
const ST_HELD = { 3002: 'service', 3015: 'supervisor' };

// Start-of-today in Europe/London as a timestamptz instant.
const LONDON_MIDNIGHT = `(date_trunc('day', now() AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London')`;

function cutoffMins(t) { if (!t) return 14 * 60; const [h, m] = String(t).split(':'); return (parseInt(h) || 0) * 60 + (parseInt(m) || 0); }

// Dispatch deadline = warehouse close / last courier collection (default 17:00).
// The per-customer cutoff (e.g. 2pm) decides WHICH orders are due today; this is
// the time they must actually be OUT by. red = within 1h, amber = within 2h.
const CLOSE_MIN = (parseInt(process.env.WAREHOUSE_CLOSE_HOUR) || 17) * 60;
function nowLondonMins() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const o = Object.fromEntries(p.map(x => [x.type, x.value]));
  return (parseInt(o.hour) % 24) * 60 + parseInt(o.minute);
}

// Diagnostic: what statuses are our undispatched orders actually in, and when
// did the order syncs last run. Reveals whether status_id reflects live workflow.
router.get('/diag', async (req, res, next) => {
  try {
    if (BOARD_KEY && req.query.key !== BOARD_KEY) return res.status(403).json({ error: 'Forbidden' });
    const [byStatus, syncs] = await Promise.all([
      query(`SELECT status_id, MAX(status_label) AS label, COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE dispatched_at IS NULL)::int AS undispatched
             FROM orders WHERE received_at >= now() - interval '7 days'
             GROUP BY status_id ORDER BY total DESC`),
      query(`SELECT sync_type, status, records, detail, ran_at FROM helm_sync_log
             WHERE sync_type IN ('sla_orders','volume','backfill') ORDER BY ran_at DESC LIMIT 5`),
    ]);
    res.json({ helm_configured: helmConfigured(), orders_by_status: byStatus.rows, recent_syncs: syncs.rows });
  } catch (err) { next(err); }
});

router.get('/board', async (req, res, next) => {
  try {
    if (BOARD_KEY && req.query.key !== BOARD_KEY) return res.status(403).json({ error: 'Forbidden — invalid board key' });

    const TODAY_LON = `(now() AT TIME ZONE 'Europe/London')::date`;
    const pipe = (ids) => query(`SELECT COUNT(*)::int AS n FROM orders WHERE status_id = ANY($1) AND dispatched_at IS NULL`, [ids]);
    const [picking, packing, dispatchReady, vol, couriers, topCustomers, topPickers, held, orders] = await Promise.all([
      pipe(ST_PICKING),
      pipe(ST_PACKING),
      pipe(ST_DISPATCH_READY),
      query(`SELECT COALESCE(SUM(parcel_count),0)::int AS parcels, COALESCE(SUM(item_count),0)::int AS items
              FROM customer_volume_snapshots WHERE snapshot_date = ${TODAY_LON}`),
      query(`SELECT COALESCE(courier_name,'Unknown') AS courier, COUNT(*)::int AS parcels
              FROM parcels WHERE created_at >= ${LONDON_MIDNIGHT} GROUP BY courier_name ORDER BY parcels DESC LIMIT 8`),
      // Top customers by today's despatch volume.
      query(`SELECT c.business_name AS name, SUM(s.parcel_count)::int AS parcels, SUM(s.item_count)::int AS items
              FROM customer_volume_snapshots s JOIN customers c ON c.id = s.customer_id
              WHERE s.snapshot_date = ${TODAY_LON} AND s.parcel_count > 0
              GROUP BY c.business_name ORDER BY parcels DESC LIMIT 6`),
      // Top pickers today (from per-person contributions).
      query(`SELECT MAX(picker_name) AS name, SUM(items)::int AS items,
                    COALESCE(SUM(handling_ms),0)::bigint AS total_ms,
                    COALESCE(SUM(items) FILTER (WHERE handling_ms > 0),0)::int AS timed_items
              FROM pick_contributions WHERE pick_date = ${TODAY_LON}
              GROUP BY user_id ORDER BY items DESC LIMIT 6`),
      // Held statuses (Service / Supervisor) with an ageing breakdown by days since received.
      query(`SELECT status_id,
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE ${TODAY_LON} - (received_at AT TIME ZONE 'Europe/London')::date >= 1)::int AS d1,
                    COUNT(*) FILTER (WHERE ${TODAY_LON} - (received_at AT TIME ZONE 'Europe/London')::date >= 3)::int AS d3,
                    COUNT(*) FILTER (WHERE ${TODAY_LON} - (received_at AT TIME ZONE 'Europe/London')::date >= 5)::int AS d5
              FROM orders WHERE status_id = ANY($1)
                AND (status_label IS NULL OR status_label NOT ILIKE '%cancel%')
              GROUP BY status_id`, [Object.keys(ST_HELD).map(Number)]),
      // All recent orders (dispatched or not) so we can judge "due today" with
      // the working-day rollover and split done vs outstanding. Parked statuses
      // (Draft/Service/Replenishment/Supervisor/Beddoes Review) are excluded.
      query(`SELECT o.received_at, o.dispatched_at, o.status_id, o.status_label, c.business_name, c.cutoff_time::text AS cutoff
              FROM orders o JOIN customers c ON c.id = o.customer_id
              WHERE o.received_at >= now() - interval '8 days'
                AND (o.status_label IS NULL OR o.status_label NOT ILIKE '%cancel%')
                AND (o.status_id IS NULL OR o.status_id <> ALL($1))`, [ST_IGNORE]),
    ]);

    // The board's core question: of orders that SHOULD ship today (received before
    // cutoff today, with weekend/bank-holiday rollover), what's done vs outstanding,
    // and how close to breaching. Workflow status is irrelevant here.
    const hs = await holidaySet();
    const today = todayLondonYmd();
    const nowM = nowLondonMins();
    const buckets = { green: 0, amber: 0, red: 0, breached: 0 };
    const byStatus = {};      // which statuses the outstanding orders sit in
    const byCustomer = {};    // distinct impacted customers
    let dispatched = 0;
    for (const o of orders.rows) {
      if (dueDateFor(o.received_at, o.cutoff, hs) !== today) continue;   // only today's commitments
      if (o.dispatched_at) { dispatched++; continue; }                   // already out → done
      const left = CLOSE_MIN - nowM;                                     // minutes to the 5pm dispatch deadline
      const st = left <= 0 ? 'breached' : left < 60 ? 'red' : left < 120 ? 'amber' : 'green';
      buckets[st]++;
      const sLabel = STATUS_LABELS[o.status_id] || o.status_label || (o.status_id != null ? `Status ${o.status_id}` : 'No status');
      byStatus[sLabel] = (byStatus[sLabel] || 0) + 1;
      const cust = o.business_name || 'Unattributed';
      byCustomer[cust] = (byCustomer[cust] || 0) + 1;
    }
    const outstanding = buckets.green + buckets.amber + buckets.red + buckets.breached;

    // Held statuses with ageing (Service / Supervisor).
    const parked = { service: { total: 0, d1: 0, d3: 0, d5: 0 }, supervisor: { total: 0, d1: 0, d3: 0, d5: 0 } };
    for (const r of held.rows) {
      const key = ST_HELD[r.status_id];
      if (key) parked[key] = { total: r.total, d1: r.d1, d3: r.d3, d5: r.d5 };
    }
    const by_status = Object.entries(byStatus).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
    const impacted_customers = Object.entries(byCustomer).map(([customer, n]) => ({ customer, n })).sort((a, b) => b.n - a.n);

    // Packing should clear by end of day — amber if anything still packing after 3pm.
    const packingStuck = packing.rows[0].n > 0 && nowM >= 15 * 60;

    res.json({
      generated_at: new Date().toISOString(),
      due_today: dispatched + outstanding,   // total that should ship today
      dispatched,                            // of those, already out
      outstanding,                           // still to go
      in_picking: picking.rows[0].n,
      in_packing: packing.rows[0].n,
      packing_stuck: packingStuck,
      dispatch_ready: dispatchReady.rows[0].n,
      parcels_sent: vol.rows[0].parcels,
      items_sent: vol.rows[0].items,
      couriers: couriers.rows,
      top_customers: topCustomers.rows,
      top_pickers: topPickers.rows.map(p => {
        const hours = Number(p.total_ms) / 3600000;
        return { name: p.name, items: p.items, items_per_hour: hours > 0 ? Math.round(p.timed_items / hours) : null };
      }),
      parked,
      sla: { ...buckets, outstanding, by_status, impacted_customers },
    });
  } catch (err) { next(err); }
});

export default router;
