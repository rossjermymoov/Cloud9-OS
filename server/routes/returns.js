/**
 * Cloud9 OS — Returns API
 * GET /api/returns        — list (filters: customer_id, search)
 * GET /api/returns/stats  — counts
 * GET /api/returns/:id    — detail
 */

import express from 'express';
import { query } from '../db/index.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { customer_id, search, limit = 100, offset = 0 } = req.query;
    const conditions = [];
    const values = [];
    let idx = 1;
    if (customer_id) { conditions.push(`r.customer_id = $${idx++}`); values.push(customer_id); }
    if (search) {
      conditions.push(`(r.reference ILIKE $${idx} OR r.order_ref ILIKE $${idx})`);
      values.push(`%${search}%`); idx++;
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [dataRes, countRes] = await Promise.all([
      query(`
        SELECT r.id, r.helm_return_id, r.reference, r.order_ref, r.status, r.reason,
               r.item_count, r.created_at, r.customer_id, c.business_name AS customer_name
        FROM returns r
        LEFT JOIN customers c ON c.id = r.customer_id
        ${where}
        ORDER BY r.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...values, parseInt(limit), parseInt(offset)]),
      query(`SELECT COUNT(*)::int AS total FROM returns r ${where}`, values),
    ]);
    res.json({ returns: dataRes.rows, total: countRes.rows[0].total });
  } catch (err) { next(err); }
});

router.get('/stats', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int     AS today,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - 6)::int AS last_7d,
        COUNT(*)::int                                              AS total
      FROM returns
    `);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM returns WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Return not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

export default router;
