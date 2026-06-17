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

router.get('/board', async (req, res, next) => {
  try {
    if (BOARD_KEY && req.query.key !== BOARD_KEY) return res.status(403).json({ error: 'Forbidden — invalid board key' });

    const pipelineSql = (ids) => `SELECT COUNT(*)::int AS n FROM orders WHERE status_id = ANY($1) AND dispatched_at IS NULL`;
    const [done, picking, packing, dispatchReady, vol, couriers, ordersDue] = await Promise.all([
      query(`SELECT COUNT(*)::int AS n FROM orders WHERE dispatched_at >= ${LONDON_MIDNIGHT}`),
      query(pipelineSql(), [ST_PICKING]),
      query(pipelineSql(), [ST_PACKING]),
      query(pipelineSql(), [ST_DISPATCH_READY]),
      query(`SELECT COALESCE(SUM(parcel_count),0)::int AS parcels, COALESCE(SUM(item_count),0)::int AS items
              FROM customer_volume_snapshots WHERE snapshot_date = (now() AT TIME ZONE 'Europe/London')::date`),
      query(`SELECT COALESCE(courier_name,'Unknown') AS courier, COUNT(*)::int AS parcels
              FROM parcels WHERE created_at >= ${LONDON_MIDNIGHT} GROUP BY courier_name ORDER BY parcels DESC LIMIT 8`),
      query(`SELECT o.id, o.received_at, c.business_name, c.cutoff_time::text AS cutoff
              FROM orders o JOIN customers c ON c.id = o.customer_id
              WHERE o.dispatched_at IS NULL AND o.received_at >= now() - interval '7 days'
                AND (o.status_label IS NULL OR o.status_label NOT ILIKE '%cancel%')`),
    ]);

    // Per-customer cutoff breach proximity (orders due TODAY only).
    const hs = await holidaySet();
    const today = todayLondonYmd();
    const nowM = nowLondonMins();
    const buckets = { green: 0, amber: 0, red: 0, breached: 0 };
    const urgent = [];
    for (const o of ordersDue.rows) {
      if (dueDateFor(o.received_at, o.cutoff, hs) !== today) continue;
      const left = cutoffMins(o.cutoff) - nowM;       // minutes to this customer's cutoff
      const st = left <= 0 ? 'breached' : left < 60 ? 'red' : left < 120 ? 'amber' : 'green';
      buckets[st]++;
      if (st !== 'green') urgent.push({ customer: o.business_name, mins_left: left, status: st, cutoff: o.cutoff });
    }
    urgent.sort((a, b) => a.mins_left - b.mins_left);

    // Packing should be empty by end of day — flag amber if anything is still
    // in packing after 15:00 (it's been scanned but not dispatched = stuck).
    const packingStuck = packing.rows[0].n > 0 && nowM >= 15 * 60;

    res.json({
      generated_at: new Date().toISOString(),
      orders_done: done.rows[0].n,
      in_picking: picking.rows[0].n,
      in_packing: packing.rows[0].n,
      packing_stuck: packingStuck,
      dispatch_ready: dispatchReady.rows[0].n,
      parcels_sent: vol.rows[0].parcels,
      items_sent: vol.rows[0].items,
      couriers: couriers.rows,
      sla: {
        ...buckets,
        due_today: buckets.green + buckets.amber + buckets.red + buckets.breached,
        urgent: urgent.slice(0, 14),
      },
    });
  } catch (err) { next(err); }
});

export default router;
