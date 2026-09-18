/**
 * Cloud9 OS — Weigh & Measure Station Routes
 *
 * GET  /api/weight-station/search?barcode=... — Instant barcode lookup (< 2ms) from local cache + Helm fallback
 * POST /api/weight-station/update            — Update weight in Helm, update local cache, write audit log
 * GET  /api/weight-station/logs              — Fetch audit history logs
 * POST /api/weight-station/sync              — Trigger full background sync of Helm inventory
 * GET  /api/weight-station/sync-status       — Check local inventory cache product count & last sync time
 */

import express from 'express';
import { query } from '../db/index.js';
import { helmConfigured, updateInventoryItem } from '../services/helmClient.js';
import { findProductsByBarcode, syncHelmProducts, getSyncProgress } from '../services/inventorySyncService.js';

const router = express.Router();

// ── Instant Barcode Search (< 2ms) ───────────────────────────────────────────
router.get('/search', async (req, res, next) => {
  try {
    const rawBarcode = String(req.query.barcode || req.query.q || '').trim();
    if (!rawBarcode) {
      return res.json({ products: [], total: 0, query: '' });
    }

    const products = await findProductsByBarcode(rawBarcode);

    res.json({
      products,
      total: products.length,
      barcode: rawBarcode,
      cached_search: true
    });
  } catch (err) {
    next(err);
  }
});

// ── Update Product Weight in Helm & Local Cache & Record Audit Log ─────────────
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
    const weightInKg = weight_unit === 'kg' ? finalWeightNum : Math.round((finalWeightNum / 1000) * 10000) / 10000;
    const weightInG = weight_unit === 'g' ? finalWeightNum : Math.round(finalWeightNum * 1000);

    const helmPayload = {
      weight: weightInKg,
      product_weight: weightInKg,
      weight_unit: 'kg'
    };

    if (new_length != null) { helmPayload.length = parseFloat(new_length); helmPayload.product_length = parseFloat(new_length); }
    if (new_width != null)  { helmPayload.width = parseFloat(new_width);   helmPayload.product_width = parseFloat(new_width); }
    if (new_height != null) { helmPayload.height = parseFloat(new_height); helmPayload.product_height = parseFloat(new_height); }

    let syncStatus = 'synced';
    let errorMessage = null;

    if (helmConfigured()) {
      try {
        await updateInventoryItem(product_id, helmPayload);
      } catch (hErr) {
        console.error('Helm inventory update error:', hErr.message);
        syncStatus = 'failed';
        errorMessage = hErr.message;
      }
    } else {
      syncStatus = 'offline_simulated';
    }

    // Update local cache immediately
    try {
      await query(`
        UPDATE helm_products SET
          weight_g = $1,
          weight_kg = $2,
          raw_weight = $3,
          raw_unit = $4,
          length = COALESCE($5, length),
          width = COALESCE($6, width),
          height = COALESCE($7, height),
          updated_at = NOW()
        WHERE helm_id = $8
      `, [
        weightInG,
        weightInKg,
        finalWeightNum,
        weight_unit,
        new_length != null ? parseFloat(new_length) : null,
        new_width != null ? parseFloat(new_width) : null,
        new_height != null ? parseFloat(new_height) : null,
        String(product_id)
      ]);
    } catch (dbErr) {
      console.warn('Failed to update local helm_products cache:', dbErr.message);
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

// ── Cache Sync Trigger & Status ───────────────────────────────────────────────
router.post('/sync', async (req, res, next) => {
  try {
    const truncate = req.body?.truncate !== false;
    // Run clean physical inventory sync in background and return immediate acknowledgement
    syncHelmProducts({ force: true, truncate }).catch(err => console.error('Inventory sync failed:', err));
    res.json({ ok: true, message: 'Clean physical inventory synchronization started' });
  } catch (err) {
    next(err);
  }
});

router.get('/sync-status', async (_req, res, next) => {
  try {
    const { rows: countRows } = await query(`SELECT COUNT(*)::int AS total, MAX(updated_at) as last_synced_at FROM helm_products`);
    const progress = getSyncProgress();
    res.json({
      total_products: countRows[0]?.total || 0,
      last_synced_at: countRows[0]?.last_synced_at || null,
      in_progress: progress.inProgress,
      progress_saved: progress.totalSaved
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
