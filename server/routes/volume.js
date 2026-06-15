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
          COALESCE(SUM(parcel_count) FILTER (WHERE snapshot_date >= CURRENT_DATE - 6), 0)::int       AS parcels_7d,
          COALESCE(SUM(item_count)   FILTER (WHERE snapshot_date >= CURRENT_DATE - 6), 0)::int       AS items_7d,
          COALESCE(SUM(parcel_count) FILTER (WHERE snapshot_date >= CURRENT_DATE - 29), 0)::int      AS parcels_30d,
          COALESCE(SUM(item_count)   FILTER (WHERE snapshot_date >= CURRENT_DATE - 29), 0)::int      AS items_30d
        FROM customer_volume_snapshots
      `),
      query(`
        SELECT
          COUNT(*) FILTER (WHERE picked_at >= CURRENT_DATE)::int        AS picks_today,
          COUNT(*) FILTER (WHERE picked_at >= CURRENT_DATE - 6)::int    AS picks_7d
        FROM pick_events
      `),
    ]);
    res.json({ ...vol.rows[0], ...picks.rows[0] });
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
