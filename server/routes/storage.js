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
import { syncStorage, dimUnitInfo } from '../services/storageService.js';

const router = express.Router();

// Debug: what unit are we converting from, and what are the biggest stored lines?
// A single-unit volume (unit_m3) far above ~1 m³ for ordinary stock is the tell
// that dimensions are being read in the wrong unit.
router.get('/debug', async (_req, res, next) => {
  try {
    const [top, coverage] = await Promise.all([
      query(`
        SELECT s.sku, s.name, s.location_name, s.qty,
               s.unit_m3::float AS unit_m3, s.volume_m3::float AS volume_m3,
               c.business_name AS customer
        FROM storage_lines s LEFT JOIN customers c ON c.id = s.customer_id
        WHERE s.has_dimensions
        ORDER BY s.volume_m3 DESC LIMIT 20`),
      query(`
        SELECT COUNT(*)::int                                              AS total_lines,
               COUNT(*) FILTER (WHERE has_dimensions)::int                AS with_dims,
               COUNT(*) FILTER (WHERE NOT has_dimensions)::int            AS without_dims,
               COALESCE(MAX(unit_m3),0)::float                            AS max_unit_m3,
               COALESCE(SUM(volume_m3),0)::float                          AS total_m3,
               COUNT(*) FILTER (WHERE unit_m3 > 1)::int                   AS lines_unit_over_1m3
        FROM storage_lines`),
    ]);
    res.json({
      dimensions: dimUnitInfo(),
      note: 'Zero-dimension SKUs are excluded (has_dimensions=false, 0 m³) and only counted in without_dims. unit_m3 is the volume of ONE unit — ordinary stock should be well under 1 m³; hundreds/thousands means the wrong unit. lines_unit_over_1m3 should normally be 0.',
      coverage: coverage.rows[0],
      biggest_lines: top.rows,
    });
  } catch (err) { next(err); }
});

router.get('/summary', async (_req, res, next) => {
  try {
    const [totals, top] = await Promise.all([
      query(`SELECT COALESCE(SUM(volume_m3),0)::float AS total_m3,
                    COUNT(DISTINCT location_id) FILTER (WHERE location_id IS NOT NULL)::int AS locations,
                    COUNT(DISTINCT helm_inventory_id)::int AS skus,
                    COUNT(*) FILTER (WHERE NOT has_dimensions)::int AS lines_without_dims
             FROM storage_lines`),
      query(`SELECT c.id, COALESCE(c.business_name,'Cloud9') AS name, COALESCE(SUM(s.volume_m3),0)::float AS m3,
                    COUNT(DISTINCT s.location_id) FILTER (WHERE s.location_id IS NOT NULL)::int AS locations
             FROM storage_lines s LEFT JOIN customers c ON c.id = s.customer_id
             GROUP BY c.id, c.business_name HAVING SUM(s.volume_m3) > 0
             ORDER BY m3 DESC LIMIT 12`),
    ]);
    res.json({ ...totals.rows[0], top_customers: top.rows });
  } catch (err) { next(err); }
});

router.get('/by-customer', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT c.id, COALESCE(c.business_name,'Cloud9') AS name,
             COALESCE(SUM(s.volume_m3),0)::float AS m3,
             COUNT(DISTINCT s.helm_inventory_id)::int AS skus,
             COUNT(DISTINCT s.location_id) FILTER (WHERE s.location_id IS NOT NULL)::int AS locations,
             COALESCE(SUM(s.qty),0)::int AS units
      FROM storage_lines s LEFT JOIN customers c ON c.id = s.customer_id
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
             (ARRAY_AGG(COALESCE(c.business_name,'Cloud9') ORDER BY s.volume_m3 DESC))[1] AS top_customer
      FROM storage_lines s LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.location_id IS NOT NULL
      GROUP BY s.location_id
      ORDER BY m3 DESC LIMIT 300`);
    res.json(rows);
  } catch (err) { next(err); }
});

// Data-quality report: every SKU with no usable dimensions, grouped by customer,
// so the team can work through them methodically (highest stock first).
router.get('/missing-dimensions', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT COALESCE(c.business_name,'Cloud9') AS customer,
             s.helm_inventory_id, MAX(s.sku) AS sku, MAX(s.name) AS name,
             COALESCE(SUM(s.qty),0)::int AS qty,
             COUNT(DISTINCT s.location_id) FILTER (WHERE s.location_id IS NOT NULL)::int AS locations
      FROM storage_lines s LEFT JOIN customers c ON c.id = s.customer_id
      WHERE NOT s.has_dimensions
      GROUP BY COALESCE(c.business_name,'Cloud9'), s.helm_inventory_id
      ORDER BY customer, qty DESC, sku`);
    // Per-customer rollup (most affected first) + a grand total.
    const byCustomerMap = {};
    for (const r of rows) {
      const b = (byCustomerMap[r.customer] ||= { customer: r.customer, missing_skus: 0, units: 0 });
      b.missing_skus++; b.units += r.qty;
    }
    const by_customer = Object.values(byCustomerMap).sort((a, b) => b.missing_skus - a.missing_skus);
    res.json({ total_missing_skus: rows.length, customers_affected: by_customer.length, by_customer, skus: rows });
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

// Live per-customer inspection — pulls inventory straight from Helm and shows
// what drives the m³ total (raw dims, stock, per-unit + total volume per SKU),
// so we can tell bad dimensions / stock from a conversion problem.
//   GET /api/storage/customer-debug?q=ccell
router.get('/customer-debug', async (req, res, next) => {
  try {
    if (!helmConfigured()) return res.status(503).json({ error: 'Helm not configured' });
    const q = (req.query.q || 'ccell').toString();

    // Cloud9 bucket = stock with no fulfilment client (customer_id NULL). Read it
    // straight from what was stored, so you can see exactly what landed there.
    if (['cloud9', 'cloud 9', 'unassigned'].includes(q.trim().toLowerCase())) {
      const [skuRows, tot] = await Promise.all([
        query(`SELECT s.helm_inventory_id, MAX(s.sku) AS sku, MAX(s.name) AS name,
                      COALESCE(SUM(s.qty),0)::int AS units,
                      COUNT(DISTINCT s.location_id) FILTER (WHERE s.location_id IS NOT NULL)::int AS locations,
                      COALESCE(MAX(s.unit_m3),0)::float AS unit_m3,
                      COALESCE(SUM(s.volume_m3),0)::float AS volume_m3,
                      bool_or(s.has_dimensions) AS has_dims
               FROM storage_lines s WHERE s.customer_id IS NULL
               GROUP BY s.helm_inventory_id ORDER BY volume_m3 DESC NULLS LAST LIMIT 50`),
        query(`SELECT COALESCE(SUM(volume_m3),0)::float AS total_m3,
                      COUNT(DISTINCT helm_inventory_id)::int AS skus,
                      COUNT(DISTINCT helm_inventory_id) FILTER (WHERE NOT has_dimensions)::int AS no_dims
               FROM storage_lines WHERE customer_id IS NULL`),
      ]);
      const t = tot.rows[0];
      return res.json({
        customer: 'Cloud9 (stock with no fulfilment client)', from_store: true,
        dimensions: dimUnitInfo(),
        totals: { total_m3: +t.total_m3.toFixed(2), sku_count: t.skus, counted: t.skus - t.no_dims, zero_dims: t.no_dims, oversize_dropped: 0, components_groups_excluded: 0 },
        note: 'These SKUs have no fulfilment client in Helm, so they were attributed to Cloud9. If you recognise any as belonging to a customer, that customer needs linking in Helm.',
        top_skus: skuRows.rows.map(r => ({ sku: r.sku, name: r.name, type: '—', L: null, W: null, H: null, units: r.units, locations: r.locations, unit_m3: r.unit_m3 || null, volume_m3: r.volume_m3, flag: r.has_dims ? null : 'no dimensions' })),
      });
    }

    const cm = await query(
      `SELECT id, business_name, helm_customer_id FROM customers
       WHERE helm_customer_id IS NOT NULL AND business_name ILIKE $1
       ORDER BY business_name LIMIT 1`, [`%${q}%`]);
    const c = cm.rows[0];
    if (!c) return res.json({ error: `No customer matching "${q}" with a Helm id` });

    // Fetch ALL types so groups are visible here; everything counts toward the
    // total EXCEPT Groups (type 3), which would double-count their components.
    const items = await fetchInventoryForClient({ helmClientId: c.helm_customer_id });
    const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
    const MAX_UNIT_M3 = 30;
    const TYPE_NAME = { 1: 'Inventory', 2: 'Component', 3: 'Group', 4: 'Packaging', 5: 'Auxiliary Packaging' };

    let total_m3 = 0, with_dims = 0, zero_dims = 0, oversize_dropped = 0, excluded_type = 0;
    const by_type = {};
    const rows = items.map(it => {
      const tnum = parseInt(it.type ?? it.product_type);
      const tname = TYPE_NAME[tnum] || (Number.isFinite(tnum) ? `Type ${tnum}` : 'Unknown');
      by_type[tname] = (by_type[tname] || 0) + 1;
      const isExcludedType = tnum === 2 || tnum === 3;   // Component or Group

      const L = num(it.product_length), W = num(it.product_width), H = num(it.product_height);
      const locs = Array.isArray(it.locations) ? it.locations : [];
      const stocked = locs.filter(l => (parseInt(l.stock_level) || 0) > 0);
      const units = stocked.length ? stocked.reduce((a, l) => a + (parseInt(l.stock_level) || 0), 0)
                                   : (parseInt(it.stock_level) || 0);
      const hasAll = L > 0 && W > 0 && H > 0;
      let unit_m3 = hasAll ? (L * W * H) / 1e6 : null;
      let flag = null, counted = false;
      if (isExcludedType) { excluded_type++; flag = `${tname} — excluded (double-counts)`; }
      else if (!hasAll) { zero_dims++; flag = 'zero/blank dimension'; }
      else if (unit_m3 > MAX_UNIT_M3) { oversize_dropped++; flag = 'implausible — dropped'; unit_m3 = null; }
      else { with_dims++; counted = true; }
      const vol = (counted && unit_m3 != null) ? +(units * unit_m3).toFixed(4) : 0;
      if (counted) total_m3 += vol;
      return {
        sku: it.sku, name: it.name, type: tname, L, W, H, units,
        locations: stocked.length,
        unit_m3: unit_m3 != null ? +unit_m3.toFixed(6) : null,
        volume_m3: vol, flag,
      };
    });

    // Surface counted SKUs first (by volume), then excluded rows so they're visible.
    rows.sort((a, b) => b.volume_m3 - a.volume_m3 || (a.flag ? 1 : 0) - (b.flag ? 1 : 0));
    res.json({
      customer: c.business_name, helm_client_id: c.helm_customer_id,
      dimensions: dimUnitInfo(),
      totals: { total_m3: +total_m3.toFixed(2), sku_count: items.length, counted: with_dims, zero_dims, oversize_dropped, components_groups_excluded: excluded_type },
      by_type,
      note: 'total_m3 counts only Inventory (1) and Packaging (4/5). Components (2) and Groups (3) are shown but excluded — they would double-count the real stocked items. L/W/H are raw cm; unit_m3 = L·W·H ÷ 1,000,000; volume_m3 = units × unit_m3.',
      top_skus: rows.slice(0, 40),
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
