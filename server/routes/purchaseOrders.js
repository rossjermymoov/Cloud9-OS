/**
 * Cloud9 OS — Purchase Orders API
 *
 * GET /api/purchase-orders             — list (filters: status, customer_id, search)
 * GET /api/purchase-orders/stats       — counts by status
 * GET /api/purchase-orders/:id         — PO detail + lines
 */

import express from 'express';
import { query } from '../db/index.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { status, customer_id, search, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const values = [];
    let idx = 1;

    if (status)      { conditions.push(`po.status = $${idx++}::po_status`); values.push(status); }
    if (customer_id) { conditions.push(`po.customer_id = $${idx++}`);        values.push(customer_id); }
    if (search) {
      conditions.push(`(po.po_number ILIKE $${idx} OR po.customer_name ILIKE $${idx})`);
      values.push(`%${search}%`); idx++;
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [dataRes, countRes] = await Promise.all([
      query(`
        SELECT po.id, po.po_number, po.customer_id, po.customer_name, po.status,
               po.expected_date, po.total_lines, po.total_units, po.created_at
        FROM purchase_orders po ${where}
        ORDER BY po.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...values, parseInt(limit), parseInt(offset)]),
      query(`SELECT COUNT(*)::int AS total FROM purchase_orders po ${where}`, values),
    ]);

    res.json({ purchase_orders: dataRes.rows, total: countRes.rows[0].total });
  } catch (err) { next(err); }
});

router.get('/stats', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'open')::int               AS open,
        COUNT(*) FILTER (WHERE status = 'partially_received')::int AS partially_received,
        COUNT(*) FILTER (WHERE status = 'received')::int           AS received,
        COUNT(*)::int                                              AS total
      FROM purchase_orders
    `);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const [poRes, linesRes] = await Promise.all([
      query(`SELECT * FROM purchase_orders WHERE id = $1`, [req.params.id]),
      query(`SELECT id, sku, description, qty_ordered, qty_received
             FROM purchase_order_lines WHERE po_id = $1 ORDER BY created_at`, [req.params.id]),
    ]);
    if (!poRes.rows.length) return res.status(404).json({ error: 'Purchase order not found' });
    res.json({ ...poRes.rows[0], lines: linesRes.rows });
  } catch (err) { next(err); }
});

export default router;
