/**
 * Cloud9 OS — Purchase Orders API
 *
 * Operational views driven by Helm's status_id:
 *   inbound     → Submitted (13) + Partially Completed (14)
 *   exceptions  → On Hold (12) OR overdue (expected_date passed, still inbound)
 *   historical  → Draft (11), Completed (15), Cancelled (16), Archived (25)
 *
 * POs belonging to deactivated customers (account_status != 'active') are hidden.
 *
 * GET /api/purchase-orders?view=inbound        — list
 * GET /api/purchase-orders/stats               — KPI counts
 * GET /api/purchase-orders/:id                 — detail + lines
 */

import express from 'express';
import { query } from '../db/index.js';

const router = express.Router();

// Effective Helm status id (falls back to the coarse status enum pre-resync).
const EFF = `COALESCE(po.helm_status_id, CASE po.status
  WHEN 'open' THEN 13 WHEN 'partially_received' THEN 14
  WHEN 'received' THEN 15 WHEN 'cancelled' THEN 16 ELSE 11 END)`;

// Hide POs whose linked customer is deactivated (only active clients shown).
const ACTIVE_ONLY = `(po.customer_id IS NULL OR c.account_status = 'active')`;

function viewClause(view) {
  switch (view) {
    case 'exceptions':
      // On hold, OR heavily overdue (expected date passed by more than 30 days).
      return `(${EFF} = 12 OR (${EFF} IN (13,14) AND po.expected_date IS NOT NULL AND po.expected_date < CURRENT_DATE - 30))`;
    case 'historical':
      return `${EFF} IN (11,15,16,25)`;
    case 'missing':
      // Submitted/partial POs with no expected date — bad data to chase up.
      return `${EFF} IN (13,14) AND po.expected_date IS NULL`;
    case 'inbound':
    default:
      // Recent incoming only — drop anything overdue by more than 30 days.
      return `${EFF} IN (13,14) AND (po.expected_date IS NULL OR po.expected_date >= CURRENT_DATE - 30)`;
  }
}

router.get('/', async (req, res, next) => {
  try {
    const view = ['inbound', 'exceptions', 'historical', 'missing'].includes(req.query.view) ? req.query.view : 'inbound';
    const { customer_id, search, limit = 500, offset = 0 } = req.query;

    const conditions = [ACTIVE_ONLY, viewClause(view)];
    const values = [];
    let idx = 1;
    if (customer_id) { conditions.push(`po.customer_id = $${idx++}`); values.push(customer_id); }
    if (search) { conditions.push(`(po.po_number ILIKE $${idx} OR po.customer_name ILIKE $${idx})`); values.push(`%${search}%`); idx++; }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const [dataRes, countRes] = await Promise.all([
      query(`
        SELECT po.id, po.po_number, po.customer_id, po.customer_name, po.status,
               ${EFF} AS eff_status, po.expected_date, po.total_lines, po.total_units, po.created_at,
               (po.expected_date IS NOT NULL AND po.expected_date < CURRENT_DATE AND ${EFF} IN (13,14)) AS overdue
        FROM purchase_orders po
        LEFT JOIN customers c ON c.id = po.customer_id
        ${where}
        ORDER BY po.expected_date ASC NULLS LAST, po.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...values, parseInt(limit), parseInt(offset)]),
      query(`SELECT COUNT(*)::int AS total FROM purchase_orders po LEFT JOIN customers c ON c.id = po.customer_id ${where}`, values),
    ]);

    res.json({ view, purchase_orders: dataRes.rows, total: countRes.rows[0].total });
  } catch (err) { next(err); }
});

router.get('/stats', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE ${EFF} = 13)::int                                                                 AS submitted,
        COUNT(*) FILTER (WHERE ${EFF} = 14)::int                                                                 AS partially_received,
        COUNT(*) FILTER (WHERE ${EFF} = 12
          OR (${EFF} IN (13,14) AND po.expected_date IS NOT NULL AND po.expected_date < CURRENT_DATE - 30))::int AS exceptions,
        COUNT(*) FILTER (WHERE ${EFF} IN (13,14) AND po.expected_date IS NULL)::int                             AS missing_date,
        COUNT(*) FILTER (WHERE ${EFF} IN (11,15,16,25))::int                                                     AS historical,
        (SELECT MAX(ran_at) FROM helm_sync_log WHERE sync_type = 'purchase_orders' AND status = 'ok')           AS last_synced
      FROM purchase_orders po
      LEFT JOIN customers c ON c.id = po.customer_id
      WHERE ${ACTIVE_ONLY}
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
    const po = poRes.rows[0];

    let lines = linesRes.rows;
    if (lines.length === 0 && po.raw_payload && Array.isArray(po.raw_payload.inventory)) {
      lines = po.raw_payload.inventory.map(l => ({
        id: l.id, sku: l.sku || null, description: l.name || null,
        qty_ordered: parseInt(l.quantity) || 0, qty_received: parseInt(l.delivered_quantity) || 0,
      }));
    }
    delete po.raw_payload;
    res.json({ ...po, lines });
  } catch (err) { next(err); }
});

export default router;
