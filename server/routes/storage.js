/**
 * Cloud9 OS — Storage footprint API (m³ per client)
 *
 * GET  /api/storage/summary       — total m³, locations used, top clients
 * GET  /api/storage/by-customer   — every customer's storage volume
 * GET  /api/storage/by-location   — volume per location (+ dominant client) for the map
 * GET  /api/storage/customer/:id  — one customer's SKUs/locations
 * GET  /api/storage/freshness     — last sync
 * POST /api/storage/sync          — recompute from Helm (background)
 */

import express from 'express';
import { query } from '../db/index.js';
import { helmConfigured, fetchInventoryForClient, fetchInventoryDetail } from '../services/helmClient.js';
import { syncStorage } from '../services/storageService.js';

const router = express.Router();

router.get('/summary', async (_req, res, next) => {
  try {
    const [totals, top] = await Promise.all([
      query(`SELECT COALESCE(SUM(volume_m3),0)::float AS total_m3,
                    COUNT(DISTINCT location_id) FILTER (WHERE location_id IS NOT NULL)::int AS locations,
                    COUNT(DISTINCT helm_inventory_id)::int AS skus,
                    COUNT(*) FILTER (WHERE NOT has_dimensions)::int AS lines_without_dims
             FROM storage_lines`),
      query(`SELECT c.id, c.business_name AS name, COALESCE(SUM(s.volume_m3),0)::float AS m3,
                    COUNT(DISTINCT s.location_id) FILTER (WHERE s.location_id IS NOT NULL)::int AS locations
             FROM storage_lines s JOIN customers c ON c.id = s.customer_id
             GROUP BY c.id, c.business_name HAVING SUM(s.volume_m3) > 0
             ORDER BY m3 DESC LIMIT 12`),
    ]);
    res.json({ ...totals.rows[0], top_customers: top.rows });
  } catch (err) { next(err); }
});

router.get('/by-customer', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT c.id, c.business_name AS name,
             COALESCE(SUM(s.volume_m3),0)::float AS m3,
             COUNT(DISTINCT s.helm_inventory_id)::int AS skus,
             COUNT(DISTINCT s.location_id) FILTER (WHERE s.location_id IS NOT NULL)::int AS locations,
             COALESCE(SUM(s.qty),0)::int AS units
      FROM storage_lines s JOIN customers c ON c.id = s.customer_id
      GROUP BY c.id, c.business_name
      ORDER BY m3 DESC`);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/by-location', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT s.location_id, MAX(s.location_name) AS location_name, MAX(s.warehouse_id) AS warehouse_id,
             COALESCE(SUM(s.volume_m3),0)::float AS m3,
             COUNT(DISTINCT s.customer_id)::int AS customers,
             COUNT(DISTINCT s.helm_inventory_id)::int AS skus,
             (ARRAY_AGG(c.business_name ORDER BY s.volume_m3 DESC))[1] AS top_customer
      FROM storage_lines s LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.location_id IS NOT NULL
      GROUP BY s.location_id
      ORDER BY m3 DESC LIMIT 300`);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/customer/:id', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT location_id, location_name, sku, name, qty, unit_m3::float AS unit_m3, volume_m3::float AS volume_m3, has_dimensions
      FROM storage_lines WHERE customer_id = $1
      ORDER BY volume_m3 DESC LIMIT 1000`, [req.params.id]);
    res.json(rows);
  } catch (err) { next(err); }
});

// Inspect a live sample so we can see the real inventory + dimensions shape.
router.get('/inspect', async (req, res, next) => {
  try {
    if (!helmConfigured()) return res.status(503).json({ error: 'Helm not configured' });
    const cm = await query(`SELECT id, business_name, helm_customer_id FROM customers
                            WHERE helm_customer_id IS NOT NULL AND account_status = 'active'
                            ORDER BY business_name LIMIT 1`);
    const c = cm.rows[0];
    if (!c) return res.json({ error: 'No active customers with a Helm id' });
    let items = [];
    try { items = await fetchInventoryForClient({ helmClientId: c.helm_customer_id, perPage: 5, maxPages: 1 }); }
    catch (e) { return res.json({ customer: c.business_name, helm_client_id: c.helm_customer_id, list_error: e.message }); }
    const sample = items[0] || null;
    let detail = null, detailErr = null;
    if (sample) { try { detail = await fetchInventoryDetail(String(sample.id)); } catch (e) { detailErr = e.message; } }
    res.json({
      customer: c.business_name, helm_client_id: c.helm_customer_id,
      inventory_first_page_count: items.length,
      list_item_keys: sample ? Object.keys(sample) : null,
      list_sample: sample ? { id: sample.id, sku: sample.sku, stock_level: sample.stock_level, locations: sample.locations } : null,
      detail_keys: detail ? Object.keys(detail) : null,
      detail_error: detailErr,
      package_configurations: detail ? (detail.package_configurations ?? detail.package_configuration ?? '(field not present)') : null,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/freshness', async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT status, records, detail, ran_at FROM helm_sync_log WHERE sync_type='storage' ORDER BY ran_at DESC LIMIT 1`);
    res.json(rows[0] || null);
  } catch (err) { next(err); }
});

router.post('/sync', async (_req, res, next) => {
  try {
    if (!helmConfigured()) return res.status(503).json({ error: 'Helm API not configured' });
    res.status(202).json({ status: 'started', message: 'Computing storage from Helm in the background. Check GET /api/storage/freshness.' });
    setImmediate(() => syncStorage());
  } catch (err) { next(err); }
});

export default router;
