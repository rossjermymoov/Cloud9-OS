/**
 * Cloud9 OS — Tracking API
 * Serves the (copied-exactly) Moov OS tracking page.
 *
 * POST /api/tracking/webhook       — ingest tracking event(s)
 * GET  /api/tracking/stats         — summary counts
 * GET  /api/tracking               — paginated parcel list
 * GET  /api/tracking/:consignment  — single parcel + event timeline
 * POST /api/tracking/refresh-stale — on-demand refresh (Helm — stub for now)
 */

import express from 'express';
import { query } from '../db/index.js';
import { normalisePayload, upsertEvent } from '../services/statusEngine.js';

const router = express.Router();

/**
 * Clear "pending collection" — anything still showing as booked/awaiting
 * collection is marked collected. Runs nightly (couriers have been by 8pm) so
 * the pending count resets to 0; also exposed as a manual endpoint.
 */
export async function clearPendingCollection({ staleOnly = false } = {}) {
  // staleOnly = clear only what was booked BEFORE today (Europe/London), so the
  // pending count reflects just today's bookings. Default clears everything.
  const cond = staleOnly
    ? `AND last_event_at < (date_trunc('day', now() AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London')`
    : '';
  const { rows } = await query(`
    UPDATE parcels
       SET status = 'collected', last_location = COALESCE(last_location, 'Collected'),
           last_event_at = NOW(), updated_at = NOW()
     WHERE status IN ('booked', 'awaiting_collection') ${cond}
     RETURNING id`);
  console.log(`🌙 Pending collection cleared${staleOnly ? ' (stale only)' : ''}: ${rows.length} parcel(s)`);
  return rows.length;
}

// POST /api/tracking/clear-pending[?stale=1] — manual trigger.
//   ?stale=1 → clear only pre-today bookings (leave today's pending).
router.post('/clear-pending', async (req, res, next) => {
  try {
    const staleOnly = req.query.stale === '1' || req.query.stale === 'true';
    res.json({ ok: true, staleOnly, cleared: await clearPendingCollection({ staleOnly }) });
  } catch (err) { next(err); }
});

// ─── POST /api/tracking/webhook ──────────────────────────────────────────────
router.post('/webhook', async (req, res, next) => {
  try {
    if (!req.body) return res.status(400).json({ error: 'Empty payload' });
    const events  = normalisePayload(req.body);
    const results = [];
    for (const event of events) results.push(await upsertEvent(event));
    res.json({ received: results.length, results });
  } catch (err) { next(err); }
});

// ─── GET /api/tracking/stats ─────────────────────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const [counts, delivered_today, by_courier, by_customer, pending_by_courier] = await Promise.all([
      query(`SELECT status, COUNT(*)::int AS count FROM parcels GROUP BY status`),
      query(`SELECT COUNT(*)::int AS count FROM parcels
             WHERE status = 'delivered' AND last_event_at >= CURRENT_DATE
               AND last_event_at < CURRENT_DATE + INTERVAL '1 day'`),
      query(`SELECT courier_name, courier_code, COUNT(*)::int AS count FROM parcels
             WHERE courier_name IS NOT NULL GROUP BY courier_name, courier_code ORDER BY count DESC`),
      query(`SELECT DISTINCT ON (p.customer_id)
               p.customer_id AS id, p.customer_name AS name, p.customer_account AS account_number
             FROM parcels p
             WHERE p.customer_id IS NOT NULL AND p.customer_name IS NOT NULL
             ORDER BY p.customer_id, p.customer_name`),
      query(`SELECT courier_name, courier_code, COUNT(*)::int AS count FROM parcels
             WHERE status = 'booked' AND courier_name IS NOT NULL
             GROUP BY courier_name, courier_code ORDER BY count DESC`),
    ]);

    const statusMap = {};
    for (const r of counts.rows) statusMap[r.status] = r.count;

    res.json({
      by_status:       statusMap,
      delivered_today: delivered_today.rows[0].count,
      total_active:    Object.entries(statusMap)
        .filter(([s]) => !['delivered','returned','cancelled','tracking_expired'].includes(s))
        .reduce((a,[,c]) => a + c, 0),
      by_courier:      by_courier.rows,
      by_customer:     by_customer.rows,
      pending_by_courier: pending_by_courier.rows,
    });
  } catch (err) { next(err); }
});

// ─── GET /api/tracking ───────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { search, status, courier_code, customer_id, date_from, date_to, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const values     = [];
    let   idx        = 1;

    if (status) {
      conditions.push(`p.status = ANY($${idx++}::parcel_status[])`);
      values.push(status.split(',').map(s => s.trim()));
    }
    if (courier_code) { conditions.push(`p.courier_code ILIKE $${idx++}`); values.push(courier_code); }
    if (customer_id)  { conditions.push(`p.customer_id = $${idx++}`);      values.push(customer_id); }
    if (date_from)    { conditions.push(`p.last_event_at >= $${idx++}`);   values.push(date_from); }
    if (date_to)      { conditions.push(`p.last_event_at < ($${idx++}::date + INTERVAL '1 day')`); values.push(date_to); }
    if (search) {
      conditions.push(`(
        p.consignment_number ILIKE $${idx} OR p.customer_name ILIKE $${idx} OR
        p.recipient_name ILIKE $${idx} OR p.recipient_postcode ILIKE $${idx} OR p.courier_name ILIKE $${idx}
      )`);
      values.push(`%${search}%`); idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [dataRes, countRes] = await Promise.all([
      query(`
        SELECT p.id, p.consignment_number, p.courier_name, p.courier_code, p.service_name,
               p.customer_name, p.customer_account, p.recipient_name, p.recipient_postcode,
               p.status, p.status_description, p.last_location,
               p.last_event_at, p.estimated_delivery, p.delivered_at, p.weight_kg, p.created_at
        FROM parcels p ${where}
        ORDER BY p.last_event_at DESC NULLS LAST, p.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...values, parseInt(limit), parseInt(offset)]),
      query(`SELECT COUNT(*)::int AS total FROM parcels p ${where}`, values),
    ]);

    res.json({ parcels: dataRes.rows, total: countRes.rows[0].total, limit: parseInt(limit), offset: parseInt(offset) });
  } catch (err) { next(err); }
});

// ─── POST /api/tracking/refresh-stale ────────────────────────────────────────
// On-demand refresh hook. With Helm this will re-request tracking; stubbed
// until the Helm tracking endpoint is wired in.
router.post('/refresh-stale', async (_req, res) => {
  res.json({ refreshed: 0, note: 'Helm on-demand tracking refresh not yet wired (awaiting API docs).' });
});

// ─── GET /api/tracking/:consignment ─────────────────────────────────────────
router.get('/:consignment', async (req, res, next) => {
  try {
    const parcelRes = await query('SELECT * FROM parcels WHERE consignment_number = $1', [req.params.consignment]);
    if (!parcelRes.rows.length) return res.status(404).json({ error: 'Parcel not found' });
    const eventsRes = await query(
      `SELECT id, event_code, status, description, location, event_at
       FROM tracking_events WHERE consignment_number = $1 ORDER BY event_at DESC`,
      [req.params.consignment]
    );
    res.json({ ...parcelRes.rows[0], events: eventsRes.rows });
  } catch (err) { next(err); }
});

// POST /api/tracking/repair-names — fix existing parcels whose displayed company
// is the ship_from/warehouse rather than the resolved customer (the brand).
router.post('/repair-names', async (_req, res, next) => {
  try {
    const a = await query(`
      UPDATE parcels p SET customer_name = c.business_name, updated_at = NOW()
      FROM customers c
      WHERE p.customer_id = c.id AND p.customer_name IS DISTINCT FROM c.business_name`);
    const b = await query(`
      UPDATE parcels SET customer_name = customer_account, updated_at = NOW()
      WHERE customer_id IS NULL AND customer_account IS NOT NULL
        AND customer_name IS DISTINCT FROM customer_account`);
    res.json({ ok: true, relinked: a.rowCount, fallback_to_accounts_id: b.rowCount });
  } catch (err) { next(err); }
});

export default router;
