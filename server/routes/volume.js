/**
 * Cloud9 OS — Dispatch volume API
 * Reads the customer_volume_snapshots populated by the Helm volume sync.
 *
 * GET /api/volume/summary             — today + 7d + 30d parcels & items
 * GET /api/volume/daily?days=14       — daily totals across all customers
 * GET /api/volume/by-customer?days=1  — per-customer totals for the window
 */

import express from 'express';
import { query } from '../db/index.js';

const router = express.Router();

router.get('/summary', async (_req, res, next) => {
  try {
    const [vol, picks] = await Promise.all([
      query(`
        SELECT
          COALESCE(SUM(parcel_count) FILTER (WHERE snapshot_date = CURRENT_DATE), 0)::int            AS parcels_today,
          COALESCE(SUM(item_count)   FILTER (WHERE snapshot_date = CURRENT_DATE), 0)::int            AS items_today,
          -- same weekday last week (for "vs last <weekday>" comparison)
          COALESCE(SUM(parcel_count) FILTER (WHERE snapshot_date = CURRENT_DATE - 7), 0)::int        AS parcels_last_week,
          COALESCE(SUM(item_count)   FILTER (WHERE snapshot_date = CURRENT_DATE - 7), 0)::int        AS items_last_week,
          COALESCE(SUM(parcel_count) FILTER (WHERE snapshot_date >= CURRENT_DATE - 6), 0)::int       AS parcels_7d,
          COALESCE(SUM(item_count)   FILTER (WHERE snapshot_date >= CURRENT_DATE - 6), 0)::int       AS items_7d
        FROM customer_volume_snapshots
      `),
      query(`
        SELECT
          COUNT(*) FILTER (WHERE picked_at >= CURRENT_DATE)::int        AS picks_today,
          -- yesterday up to the current time-of-day, for a like-for-like compare
          COUNT(*) FILTER (
            WHERE picked_at >= CURRENT_DATE - INTERVAL '1 day'
              AND picked_at <  (CURRENT_DATE - INTERVAL '1 day') + (NOW() - CURRENT_DATE)
          )::int AS picks_yesterday_to_hour,
          COUNT(*) FILTER (WHERE picked_at >= CURRENT_DATE - 6)::int    AS picks_7d
        FROM pick_events
      `),
    ]);
    res.json({ ...vol.rows[0], ...picks.rows[0] });
  } catch (err) { next(err); }
});

// ── This week vs last week, aligned by weekday (Mon–Sun) ──────
router.get('/weekly', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT snapshot_date::text AS date, SUM(parcel_count)::int AS parcels, SUM(item_count)::int AS items
      FROM customer_volume_snapshots
      WHERE snapshot_date >= (date_trunc('week', CURRENT_DATE)::date - 7)
      GROUP BY snapshot_date
    `);
    const map = Object.fromEntries(rows.map(r => [r.date, r]));

    const now = new Date();
    const dow = (now.getDay() + 6) % 7;            // 0 = Monday
    const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(now.getDate() - dow);
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    const this_week = [], last_week = [];
    for (let i = 0; i < 7; i++) {
      const t = new Date(monday); t.setDate(monday.getDate() + i);
      const l = new Date(monday); l.setDate(monday.getDate() - 7 + i);
      const isFuture = t > now;
      this_week.push({ label: LABELS[i], parcels: isFuture ? null : (map[fmt(t)]?.parcels || 0) });
      last_week.push({ label: LABELS[i], parcels: map[fmt(l)]?.parcels || 0 });
    }
    res.json({ this_week, last_week });
  } catch (err) { next(err); }
});

// ── Top customers by month-over-month growth ──────────────────
router.get('/leaderboard', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 5, 1), 20);
    const { rows } = await query(`
      SELECT c.id, c.business_name,
             COALESCE(o.orders_today, 0)::int AS orders_today,
             COALESCE(tm.parcels, 0)::int     AS this_month,
             COALESCE(lm.parcels, 0)::int     AS last_month
      FROM customers c
      LEFT JOIN (
        SELECT customer_id, COUNT(*) AS orders_today FROM orders
        WHERE dispatched_at::date = CURRENT_DATE GROUP BY customer_id
      ) o ON o.customer_id = c.id
      LEFT JOIN (
        SELECT customer_id, SUM(parcel_count) AS parcels FROM customer_volume_snapshots
        WHERE date_trunc('month', snapshot_date) = date_trunc('month', CURRENT_DATE) GROUP BY customer_id
      ) tm ON tm.customer_id = c.id
      LEFT JOIN (
        SELECT customer_id, SUM(parcel_count) AS parcels FROM customer_volume_snapshots
        WHERE date_trunc('month', snapshot_date) = date_trunc('month', CURRENT_DATE - INTERVAL '1 month') GROUP BY customer_id
      ) lm ON lm.customer_id = c.id
      WHERE COALESCE(tm.parcels,0) + COALESCE(lm.parcels,0) > 0
    `);

    const ranked = rows.map(r => {
      const mom = r.last_month > 0
        ? ((r.this_month - r.last_month) / r.last_month) * 100
        : (r.this_month > 0 ? null : 0);   // null = brand-new (no prior month)
      return { ...r, mom_pct: mom == null ? null : Math.round(mom * 10) / 10 };
    }).sort((a, b) => {
      const av = a.mom_pct == null ? Infinity : a.mom_pct;
      const bv = b.mom_pct == null ? Infinity : b.mom_pct;
      return bv - av;
    }).slice(0, limit);

    res.json(ranked);
  } catch (err) { next(err); }
});

router.get('/picks', async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 14, 1), 180);
    const { rows } = await query(`
      SELECT picked_at::date::text AS date, COUNT(*)::int AS picks
      FROM pick_events
      WHERE picked_at >= CURRENT_DATE - ($1::int - 1)
      GROUP BY picked_at::date ORDER BY picked_at::date ASC
    `, [days]);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/daily', async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 14, 1), 180);
    const { rows } = await query(`
      SELECT snapshot_date::text AS date,
             SUM(parcel_count)::int AS parcels,
             SUM(item_count)::int   AS items
      FROM customer_volume_snapshots
      WHERE snapshot_date >= CURRENT_DATE - ($1::int - 1)
      GROUP BY snapshot_date
      ORDER BY snapshot_date ASC
    `, [days]);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/by-customer', async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 1, 1), 365);
    const { rows } = await query(`
      SELECT c.id, c.business_name, c.account_number,
             COALESCE(SUM(v.parcel_count), 0)::int AS parcels,
             COALESCE(SUM(v.item_count), 0)::int   AS items
      FROM customers c
      LEFT JOIN customer_volume_snapshots v
        ON v.customer_id = c.id AND v.snapshot_date >= CURRENT_DATE - ($1::int - 1)
      GROUP BY c.id, c.business_name, c.account_number
      HAVING COALESCE(SUM(v.parcel_count), 0) > 0
      ORDER BY parcels DESC
    `, [days]);
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
