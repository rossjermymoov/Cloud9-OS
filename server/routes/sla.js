/**
 * Cloud9 OS — On-time dispatch SLA API
 *
 * GET  /api/sla/summary?period=&customer_id=   — on-time %, breach + pending counts
 * GET  /api/sla/breaches?period=&customer_id=&view=breaches|pending|all
 * GET  /api/sla/cutoffs                          — customers + their cutoff times
 * PATCH /api/sla/cutoffs/:id   { cutoff_time }    — set a customer's cutoff
 * POST /api/sla/sync?days=14                      — pull recent orders from Helm
 * GET  /api/sla/freshness                         — last order sync
 */

import express from 'express';
import { query } from '../db/index.js';
import { helmConfigured } from '../services/helmClient.js';
import { evaluateOrders, syncRecentOrders } from '../services/slaService.js';

const router = express.Router();

function rangeFor(periodRaw, dateRaw) {
  const p = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { period: 'custom', from: dateRaw, to: dateRaw };
  const period = ['day', 'yesterday', 'week', 'month', 'quarter'].includes(periodRaw) ? periodRaw : 'week';
  const today = new Date();
  let from = new Date(today), to = new Date(today);
  if (period === 'yesterday') { from.setDate(today.getDate() - 1); to.setDate(today.getDate() - 1); }
  else if (period === 'week')  from.setDate(today.getDate() - 6);
  else if (period === 'month') from.setDate(today.getDate() - 29);
  else if (period === 'quarter') from.setDate(today.getDate() - 89);
  return { period, from: iso(from), to: iso(to) };
}

router.get('/status', (_req, res) => res.json({ configured: helmConfigured() }));

router.get('/summary', async (req, res, next) => {
  try {
    const { period, from, to } = rangeFor(req.query.period, req.query.date);
    const r = await evaluateOrders({ fromYmd: from, toYmd: to, customerId: req.query.customer_id || null });
    res.json({
      period, from, to,
      assessed: r.rows.length,
      on_time: r.counts.on_time,
      breaches: r.breaches,
      breach_late: r.counts.breach_late,
      breach_overdue: r.counts.breach_overdue,
      pending: r.counts.pending,
      on_time_pct: r.on_time_pct,
    });
  } catch (err) { next(err); }
});

router.get('/breaches', async (req, res, next) => {
  try {
    const { period, from, to } = rangeFor(req.query.period, req.query.date);
    const view = ['breaches', 'pending', 'all'].includes(req.query.view) ? req.query.view : 'breaches';
    const r = await evaluateOrders({ fromYmd: from, toYmd: to, customerId: req.query.customer_id || null });

    let rows = r.rows;
    if (view === 'breaches') rows = rows.filter(x => x.sla_status === 'breach_late' || x.sla_status === 'breach_overdue');
    else if (view === 'pending') rows = rows.filter(x => x.sla_status === 'pending');

    // Per-customer rollup (always over breaches) for the breakdown panel.
    const byCustomer = {};
    for (const x of r.rows) {
      const b = (byCustomer[x.customer_id] ||= { customer_id: x.customer_id, business_name: x.business_name, on_time: 0, breaches: 0, pending: 0 });
      if (x.sla_status === 'on_time') b.on_time++;
      else if (x.sla_status === 'pending') b.pending++;
      else if (x.sla_status.startsWith('breach')) b.breaches++;
    }
    const customers = Object.values(byCustomer)
      .map(c => ({ ...c, on_time_pct: (c.on_time + c.breaches) > 0 ? Math.round((c.on_time / (c.on_time + c.breaches)) * 1000) / 10 : null }))
      .sort((a, b) => b.breaches - a.breaches);

    res.json({
      period, from, to, view,
      rows: rows.map(x => ({
        id: x.id, order_ref: x.channel_order_id || x.helm_order_id,
        business_name: x.business_name, received_at: x.received_at, dispatched_at: x.dispatched_at,
        due: x.due, sla_status: x.sla_status, parcels: x.parcel_count, items: x.item_count,
      })),
      customers,
    });
  } catch (err) { next(err); }
});

router.get('/cutoffs', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT id, business_name, helm_accounts_id, cutoff_time::text AS cutoff_time, account_status
      FROM customers WHERE account_status = 'active' ORDER BY business_name ASC
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

router.patch('/cutoffs/:id', async (req, res, next) => {
  try {
    const t = String(req.body?.cutoff_time || '').trim();
    if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return res.status(400).json({ error: 'cutoff_time must be HH:MM' });
    const { rows } = await query(
      `UPDATE customers SET cutoff_time = $1, updated_at = NOW() WHERE id = $2 RETURNING id, cutoff_time::text AS cutoff_time`,
      [t.length === 5 ? `${t}:00` : t, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'customer not found' });
    res.json({ ok: true, ...rows[0] });
  } catch (err) { next(err); }
});

router.get('/freshness', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT status, records, detail, ran_at FROM helm_sync_log WHERE sync_type='sla_orders' ORDER BY ran_at DESC LIMIT 1`
    );
    res.json(rows[0] || null);
  } catch (err) { next(err); }
});

router.post('/sync', async (req, res, next) => {
  try {
    if (!helmConfigured()) return res.status(503).json({ error: 'Helm API not configured' });
    const days = Math.min(Math.max(parseInt(req.query.days) || 14, 1), 120);
    res.status(202).json({ status: 'started', days, message: 'Pulling recent orders in the background. Check GET /api/sla/freshness.' });
    setImmediate(() => syncRecentOrders(days));
  } catch (err) { next(err); }
});

export default router;
