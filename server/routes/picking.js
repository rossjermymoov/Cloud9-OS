/**
 * Cloud9 OS — Picking API
 *
 * GET  /api/picking/status                  — is Helm configured?
 * GET  /api/picking/summary?period=         — headline KPIs for the period
 * GET  /api/picking/daily?period=           — picks + items per day (chart)
 * GET  /api/picking/leaderboard?period=     — per-picker performance (items/hour headline)
 * GET  /api/picking/freshness               — last sync time
 * POST /api/picking/sync?days=30            — pull picks from Helm (background)
 *
 * All performance metrics are computed on COMPLETED picks (status = 1), bucketed
 * by completion date (`pick_date`). Time basis per pick = active handling time
 * (sum of Helm time-tracking durations), falling back to wall-clock elapsed.
 */

import express from 'express';
import { query } from '../db/index.js';
import { helmConfigured } from '../services/helmClient.js';
import { syncPicks } from '../services/pickingService.js';

const router = express.Router();

const p2 = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

// A single custom day, clamped to the last 90 days.
function parseCustomDate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return null;
  const d = new Date(`${s}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const min = new Date(today); min.setDate(today.getDate() - 90);
  if (d > today) return today;
  if (d < min) return min;
  return d;
}

function rangeFor(periodRaw, dateRaw) {
  const custom = parseCustomDate(dateRaw);
  if (custom) return { period: 'custom', from: isoDay(custom), to: isoDay(custom) };
  const period = ['day', 'yesterday', 'week', 'month', 'quarter'].includes(periodRaw) ? periodRaw : 'week';
  const today = new Date();
  let from = new Date(today), to = new Date(today);
  if (period === 'day')           { /* today only */ }
  else if (period === 'yesterday') { from.setDate(today.getDate() - 1); to.setDate(today.getDate() - 1); }
  else if (period === 'week')      { from.setDate(today.getDate() - 6); }
  else if (period === 'month')     { from.setDate(today.getDate() - 29); }
  else if (period === 'quarter')   { from.setDate(today.getDate() - 89); }
  return { period, from: isoDay(from), to: isoDay(to) };
}

// Per-pick time basis (ms): prefer active handling time, fall back to elapsed.
const TIME_BASIS = `COALESCE(NULLIF(handling_ms,0), NULLIF(elapsed_ms,0), 0)`;
const COMPLETED = `status = 1 AND pick_date IS NOT NULL`;

router.get('/status', (_req, res) => res.json({ configured: helmConfigured() }));

router.get('/summary', async (req, res, next) => {
  try {
    const { period, from, to } = rangeFor(req.query.period, req.query.date);
    const { rows } = await query(`
      SELECT
        COUNT(*)::int                                   AS picks,
        COALESCE(SUM(item_count),0)::int                AS items,
        COALESCE(SUM(order_count),0)::int               AS orders,
        COALESCE(SUM(${TIME_BASIS}),0)::bigint          AS total_ms,
        COUNT(*) FILTER (WHERE ${TIME_BASIS} > 0)::int  AS timed_picks
      FROM picks
      WHERE ${COMPLETED} AND pick_date >= $1 AND pick_date <= $2
    `, [from, to]);
    const r = rows[0];
    const hours = r.total_ms / 3600000;
    res.json({
      period, from, to,
      picks: r.picks,
      items: r.items,
      orders: r.orders,
      avg_items_per_pick: r.picks ? +(r.items / r.picks).toFixed(1) : 0,
      avg_secs_per_pick:  r.timed_picks ? Math.round((r.total_ms / r.timed_picks) / 1000) : null,
      items_per_hour:     hours > 0 ? Math.round(r.items / hours) : null,
    });
  } catch (err) { next(err); }
});

router.get('/daily', async (req, res, next) => {
  try {
    const { period, from, to } = rangeFor(req.query.period, req.query.date);
    const { rows } = await query(`
      SELECT pick_date::text AS date,
             COUNT(*)::int AS picks,
             COALESCE(SUM(item_count),0)::int AS items
      FROM picks
      WHERE ${COMPLETED} AND pick_date >= $1 AND pick_date <= $2
      GROUP BY pick_date ORDER BY pick_date ASC
    `, [from, to]);
    res.json({ period, from, to, days: rows });
  } catch (err) { next(err); }
});

router.get('/leaderboard', async (req, res, next) => {
  try {
    const { period, from, to } = rangeFor(req.query.period, req.query.date);
    const { rows } = await query(`
      SELECT
        picker_id,
        COALESCE(MAX(picker_name), 'Unassigned')        AS picker_name,
        COUNT(*)::int                                   AS picks,
        COALESCE(SUM(item_count),0)::int                AS items,
        COALESCE(SUM(order_count),0)::int               AS orders,
        COALESCE(SUM(${TIME_BASIS}),0)::bigint          AS total_ms,
        COUNT(*) FILTER (WHERE ${TIME_BASIS} > 0)::int  AS timed_picks
      FROM picks
      WHERE ${COMPLETED} AND picker_id IS NOT NULL AND pick_date >= $1 AND pick_date <= $2
      GROUP BY picker_id
    `, [from, to]);

    const ranked = rows.map(r => {
      const hours = Number(r.total_ms) / 3600000;
      return {
        picker_id: r.picker_id,
        picker_name: r.picker_name,
        picks: r.picks,
        items: r.items,
        orders: r.orders,
        hours: +hours.toFixed(2),
        items_per_hour: hours > 0 ? Math.round(r.items / hours) : null,
        avg_secs_per_pick: r.timed_picks ? Math.round((Number(r.total_ms) / r.timed_picks) / 1000) : null,
      };
    }).sort((a, b) => (b.items_per_hour ?? -1) - (a.items_per_hour ?? -1));

    res.json({ period, from, to, rows: ranked });
  } catch (err) { next(err); }
});

router.get('/freshness', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT status, records, detail, ran_at FROM helm_sync_log WHERE sync_type='picking' ORDER BY ran_at DESC LIMIT 1`
    );
    res.json(rows[0] || null);
  } catch (err) { next(err); }
});

router.post('/sync', async (req, res, next) => {
  try {
    if (!helmConfigured()) return res.status(503).json({ error: 'Helm API not configured' });
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
    res.status(202).json({ status: 'started', days, message: 'Pulling picks in the background. Check GET /api/picking/freshness.' });
    setImmediate(() => syncPicks(days, { pickDelayMs: 60 }));
  } catch (err) { next(err); }
});

export default router;
