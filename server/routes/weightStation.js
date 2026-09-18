/**
 * Cloud9 OS — Weigh & Measure Station Routes
 *
 * GET  /api/weight-station/search?q=...   — Search products in Helm across all clients by barcode or SKU
 * POST /api/weight-station/update        — Update weight & dimensions in Helm and log audit trail
 * GET  /api/weight-station/logs          — Fetch audit history logs
 */

import express from 'express';
import { query } from '../db/index.js';
import { helmConfigured, authedGet, updateInventoryItem, fetchInventoryDetail } from '../services/helmClient.js';

const router = express.Router();

function extractItemDims(it) {
  const pkg = Array.isArray(it.package_configurations) && it.package_configurations[0]
    ? it.package_configurations[0]
    : (it.package_configuration || it.package || {});

  const l = parseFloat(it.length ?? it.product_length ?? pkg.length ?? pkg.product_length ?? 0) || 0;
  const w = parseFloat(it.width ?? it.product_width ?? pkg.width ?? pkg.product_width ?? 0) || 0;
  const h = parseFloat(it.height ?? it.product_height ?? pkg.height ?? pkg.product_height ?? 0) || 0;

  let rawWeight = parseFloat(it.weight ?? it.product_weight ?? pkg.weight ?? pkg.product_weight ?? 0) || 0;
  const unit = String(it.weight_unit || pkg.weight_unit || (rawWeight > 0 && rawWeight < 50 ? 'kg' : 'g')).toLowerCase();
  
  // Normalized weight in grams and kg
  const weightGrams = unit === 'kg' ? Math.round(rawWeight * 1000 * 100) / 100 : rawWeight;
  const weightKg = unit === 'kg' ? rawWeight : Math.round((rawWeight / 1000) * 1000) / 1000;

  // Extract image
  let image = it.image_url || it.image || it.product_image || it.thumbnail_url || null;
  if (!image && Array.isArray(it.images) && it.images[0]) {
    image = typeof it.images[0] === 'string' ? it.images[0] : (it.images[0].url || it.images[0].src || null);
  }

  return {
    length: l,
    width: w,
    height: h,
    dimension_unit: 'cm',
    weight_g: weightGrams,
    weight_kg: weightKg,
    raw_weight: rawWeight,
    raw_unit: unit,
    image_url: image,
    pkg_config: pkg
  };
}

// ── Search Helm for products matching barcode or SKU ─────────────────────────
router.get('/search', async (req, res, next) => {
  try {
    const rawQ = String(req.query.q || req.query.barcode || '').trim();
    if (!rawQ) return res.json({ products: [] });

    if (!helmConfigured()) {
      return res.status(503).json({ error: 'Helm API not configured' });
    }

    // Load customer map from DB: helm_customer_id -> customer info
    const custRes = await query(`SELECT id, helm_customer_id, business_name, primary_email FROM customers WHERE helm_customer_id IS NOT NULL`);
    const custMap = new Map();
    for (const c of custRes.rows) {
      custMap.set(String(c.helm_customer_id), c);
    }

    const matchedItems = [];
    const seenIds = new Set();

    // 1. Try search by barcode
    try {
      const byBarcode = await authedGet('/inventory', { 'filters[barcode]': rawQ, limit: 50 });
      if (Array.isArray(byBarcode?.data)) {
        for (const it of byBarcode.data) {
          if (!seenIds.has(it.id)) {
            seenIds.add(it.id);
            matchedItems.push(it);
          }
        }
      }
    } catch {}

    // 2. Try search by SKU
    try {
      const bySku = await authedGet('/inventory', { 'filters[sku]': rawQ, limit: 50 });
      if (Array.isArray(bySku?.data)) {
        for (const it of bySku.data) {
          if (!seenIds.has(it.id)) {
            seenIds.add(it.id);
            matchedItems.push(it);
          }
        }
      }
    } catch {}

    // 3. Try general search filter
    if (matchedItems.length === 0) {
      try {
        const bySearch = await authedGet('/inventory', { 'filters[search]': rawQ, limit: 50 });
        if (Array.isArray(bySearch?.data)) {
          for (const it of bySearch.data) {
            if (!seenIds.has(it.id)) {
              seenIds.add(it.id);
              matchedItems.push(it);
            }
          }
        }
      } catch {}
    }

    // Decorate each matched item with detail and customer mapping
    const products = await Promise.all(matchedItems.map(async (it) => {
      let detail = it;
      try {
        const d = await fetchInventoryDetail(it.id);
        if (d?.data) detail = { ...it, ...d.data };
        else if (d && typeof d === 'object') detail = { ...it, ...d };
      } catch {}

      const dims = extractItemDims(detail);
      const helmClientId = String(detail.fulfilment_client_id || detail.client_id || detail.customer_id || '');
      const cust = custMap.get(helmClientId) || null;

      return {
        id: String(detail.id),
        sku: detail.sku || detail.product_sku || '',
        name: detail.name || detail.title || detail.product_name || 'Unnamed Product',
        barcode: detail.barcode || detail.product_barcode || rawQ,
        image_url: dims.image_url,
        length: dims.length,
        width: dims.width,
        height: dims.height,
        dimension_unit: dims.dimension_unit,
        weight_g: dims.weight_g,
        weight_kg: dims.weight_kg,
        raw_unit: dims.raw_unit,
        stock_level: detail.stock_level ?? detail.quantity ?? null,
        locations: Array.isArray(detail.locations) ? detail.locations : [],
        customer_id: cust ? cust.id : null,
        helm_customer_id: helmClientId || (cust ? cust.helm_customer_id : null),
        customer_name: cust ? cust.business_name : (detail.fulfilment_client?.name || `Customer #${helmClientId || 'Unknown'}`),
      };
    }));

    res.json({ products, total: products.length, query: rawQ });
  } catch (err) {
    next(err);
  }
});

// ── Update Product Weight & Dimensions in Helm & Record Audit Log ─────────────
router.post('/update', async (req, res, next) => {
  try {
    const {
      product_id,
      sku,
      customer_id,
      helm_customer_id,
      customer_name,
      product_name,
      barcode,
      new_weight,       // numeric
      weight_unit = 'g', // 'g' or 'kg'
      old_weight = null,
      new_length = null,
      new_width = null,
      new_height = null,
      old_length = null,
      old_width = null,
      old_height = null,
      dimension_unit = 'cm',
      notes = null
    } = req.body || {};

    if (!product_id || !sku) {
      return res.status(400).json({ error: 'Product ID and SKU are required' });
    }
    if (new_weight == null || isNaN(parseFloat(new_weight))) {
      return res.status(400).json({ error: 'A valid numeric weight is required' });
    }

    const finalWeightNum = parseFloat(new_weight);

    // Normalize weight for Helm
    // If unit is grams, weight in kg = weight / 1000
    const weightInKg = weight_unit === 'kg' ? finalWeightNum : Math.round((finalWeightNum / 1000) * 10000) / 10000;
    const weightInG = weight_unit === 'g' ? finalWeightNum : Math.round(finalWeightNum * 1000);

    // Prepare Helm API payload
    const helmPayload = {
      weight: weightInKg,
      product_weight: weightInKg,
      weight_unit: 'kg'
    };

    if (new_length != null) { helmPayload.length = parseFloat(new_length); helmPayload.product_length = parseFloat(new_length); }
    if (new_width != null)  { helmPayload.width = parseFloat(new_width);   helmPayload.product_width = parseFloat(new_width); }
    if (new_height != null) { helmPayload.height = parseFloat(new_height); helmPayload.product_height = parseFloat(new_height); }

    let helmResult = null;
    let syncStatus = 'synced';
    let errorMessage = null;

    if (helmConfigured()) {
      try {
        helmResult = await updateInventoryItem(product_id, helmPayload);
      } catch (hErr) {
        console.error('Helm inventory update error:', hErr.message);
        syncStatus = 'failed';
        errorMessage = hErr.message;
      }
    } else {
      syncStatus = 'offline_simulated';
    }

    // Record audit log
    const user = req.user || {};
    const { rows: logRows } = await query(
      `INSERT INTO inventory_weight_logs (
        customer_id, helm_customer_id, customer_name, product_id, sku, barcode,
        product_name, old_weight, new_weight, weight_unit,
        old_length, new_length, old_width, new_width, old_height, new_height, dimension_unit,
        user_id, user_name, user_email, status, notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
      ) RETURNING *`,
      [
        customer_id || null,
        helm_customer_id || null,
        customer_name || null,
        String(product_id),
        String(sku),
        barcode || null,
        product_name || null,
        old_weight != null ? parseFloat(old_weight) : null,
        finalWeightNum,
        weight_unit,
        old_length != null ? parseFloat(old_length) : null,
        new_length != null ? parseFloat(new_length) : null,
        old_width != null ? parseFloat(old_width) : null,
        new_width != null ? parseFloat(new_width) : null,
        old_height != null ? parseFloat(old_height) : null,
        new_height != null ? parseFloat(new_height) : null,
        dimension_unit,
        user.id || null,
        user.full_name || 'Station Operator',
        user.email || 'operator@cloud9.internal',
        syncStatus,
        errorMessage ? `Helm error: ${errorMessage}` : notes
      ]
    );

    res.json({
      ok: syncStatus !== 'failed',
      sync_status: syncStatus,
      error: errorMessage,
      log: logRows[0],
      weight_g: weightInG,
      weight_kg: weightInKg
    });
  } catch (err) {
    next(err);
  }
});

// ── Fetch Audit History Logs ──────────────────────────────────────────────────
router.get('/logs', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const q = (req.query.q || '').trim();

    let whereClause = '';
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      whereClause = `WHERE (
        sku ILIKE $1 OR
        barcode ILIKE $1 OR
        product_name ILIKE $1 OR
        customer_name ILIKE $1 OR
        user_name ILIKE $1
      )`;
    }

    const countQuery = `SELECT COUNT(*)::int AS total FROM inventory_weight_logs ${whereClause}`;
    const { rows: countRows } = await query(countQuery, params);
    const total = countRows[0]?.total || 0;

    const dataQuery = `
      SELECT id, customer_id, helm_customer_id, customer_name, product_id, sku, barcode,
             product_name, old_weight, new_weight, weight_unit,
             old_length, new_length, old_width, new_width, old_height, new_height, dimension_unit,
             user_id, user_name, user_email, status, notes, created_at
      FROM inventory_weight_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const { rows: logs } = await query(dataQuery, [...params, limit, offset]);

    res.json({ logs, total, limit, offset });
  } catch (err) {
    next(err);
  }
});

export default router;
