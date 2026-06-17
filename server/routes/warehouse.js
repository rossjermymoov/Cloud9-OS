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

// Start-of-today in Europe/London as a timestamptz instant.
const LONDON_MIDNIGHT = `(date_trunc('day', now() AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London')`;

function cutoffMins(t) { if (!t) return 14 * 60; const [h, m] = String(t).split(':'); return (parseInt(h) || 0) * 60 + (parseInt(m) || 0); }
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

    const pipe = (ids) => query(`SELECT COUNT(*)::int AS n FROM orders WHERE status_id = ANY($1) AND dispatched_at IS NULL`, [ids]);
    const [picking, packing, dispatchReady, vol, couriers, orders] = await Promise.all([
      pipe(ST_PICKING),
      pipe(ST_PACKING),
      pipe(ST_DISPATCH_READY),
      query(`SELECT COALESCE(SUM(parcel_count),0)::int AS parcels, COALESCE(SUM(item_count),0)::int AS items
              FROM customer_volume_snapshots WHERE snapshot_date = (now() AT TIME ZONE 'Europe/London')::date`),
      query(`SELECT COALESCE(courier_name,'Unknown') AS courier, COUNT(*)::int AS parcels
              FROM parcels WHERE created_at >= ${LONDON_MIDNIGHT} GROUP BY courier_name ORDER BY parcels DESC LIMIT 8`),
      // All recent orders (dispatched or not) so we can judge "due today" with
      // the working-day rollover and split done vs outstanding.
      query(`SELECT o.received_at, o.dispatched_at, c.business_name, c.cutoff_time::text AS cutoff
              FROM orders o JOIN customers c ON c.id = o.customer_id
              WHERE o.received_at >= now() - interval '8 days'
                AND (o.status_label IS NULL OR o.status_label NOT ILIKE '%cancel%')`),
    ]);

    // The board's core question: of orders that SHOULD ship today (received before
    // cutoff today, with weekend/bank-holiday rollover), what's done vs outstanding,
    // and how close to breaching. Workflow status is irrelevant here.
    const hs = await holidaySet();
    const today = todayLondonYmd();
    const nowM = nowLondonMins();
    const buckets = { green: 0, amber: 0, red: 0, breached: 0 };
    const urgent = [];
    let dispatched = 0;
    for (const o of orders.rows) {
      if (dueDateFor(o.received_at, o.cutoff, hs) !== today) continue;   // only today's commitments
      if (o.dispatched_at) { dispatched++; continue; }                   // already out → done
      const left = cutoffMins(o.cutoff) - nowM;                          // minutes to this customer's cutoff
      const st = left <= 0 ? 'breached' : left < 60 ? 'red' : left < 120 ? 'amber' : 'green';
      buckets[st]++;
      if (st !== 'green') urgent.push({ customer: o.business_name, mins_left: left, status: st });
    }
    urgent.sort((a, b) => a.mins_left - b.mins_left);
    const outstanding = buckets.green + buckets.amber + buckets.red + buckets.breached;

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
      sla: { ...buckets, urgent: urgent.slice(0, 14) },
    });
  } catch (err) { next(err); }
});

export default router;
