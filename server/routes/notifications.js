/**
 * Cloud9 OS — Notification Center API
 *
 * GET    /api/notifications                  — central feed (filters: type, severity, unread, customer_id)
 * GET    /api/notifications/stats            — unread + by-severity counts
 * POST   /api/notifications/:id/read         — mark one read
 * POST   /api/notifications/read-all         — mark all read
 */

import express from 'express';
import { query } from '../db/index.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { type, severity, unread, customer_id, resolved, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const values = [];
    let idx = 1;

    if (type)        { conditions.push(`type = $${idx++}::notification_type`); values.push(type); }
    if (severity)    { conditions.push(`severity = $${idx++}::notification_severity`); values.push(severity); }
    if (customer_id) { conditions.push(`customer_id = $${idx++}`); values.push(customer_id); }
    if (unread === 'true') conditions.push(`read_at IS NULL`);
    // Hide resolved (auto-cleared) alerts by default; pass ?resolved=all to include them.
    if (resolved !== 'all') conditions.push(`resolved_at IS NULL`);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [dataRes, countRes] = await Promise.all([
      query(`SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, parseInt(limit), parseInt(offset)]),
      query(`SELECT COUNT(*)::int AS total FROM notifications ${where}`, values),
    ]);

    res.json({ notifications: dataRes.rows, total: countRes.rows[0].total });
  } catch (err) { next(err); }
});

router.get('/stats', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE read_at IS NULL)::int                         AS unread,
        COUNT(*) FILTER (WHERE severity = 'red'   AND read_at IS NULL)::int   AS red,
        COUNT(*) FILTER (WHERE severity = 'amber' AND read_at IS NULL)::int   AS amber,
        COUNT(*)::int                                                         AS total
      FROM notifications
      WHERE resolved_at IS NULL
    `);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE notifications SET read_at = NOW() WHERE id = $1 AND read_at IS NULL RETURNING id`,
      [req.params.id]
    );
    res.json({ ok: true, updated: rows.length });
  } catch (err) { next(err); }
});

router.post('/read-all', async (_req, res, next) => {
  try {
    const { rows } = await query(`UPDATE notifications SET read_at = NOW() WHERE read_at IS NULL RETURNING id`);
    res.json({ ok: true, updated: rows.length });
  } catch (err) { next(err); }
});

export default router;
