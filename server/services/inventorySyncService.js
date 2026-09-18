/**
 * Cloud9 OS — Helm Inventory Cache & Synchronization Service
 *
 * Fast sub-millisecond barcode lookups and scheduled background inventory caching.
 */

import { query } from '../db/index.js';
import { helmConfigured, fetchInventoryForClient, fetchInventoryDetail, authedGet } from './helmClient.js';

export function extractItemPhysicals(it) {
  const pkg = Array.isArray(it.package_configurations) && it.package_configurations[0]
    ? it.package_configurations[0]
    : (it.package_configuration || it.package || {});

  const l = parseFloat(it.length ?? it.product_length ?? pkg.length ?? pkg.product_length ?? 0) || 0;
  const w = parseFloat(it.width ?? it.product_width ?? pkg.width ?? pkg.product_width ?? 0) || 0;
  const h = parseFloat(it.height ?? it.product_height ?? pkg.height ?? pkg.product_height ?? 0) || 0;

  let rawWeight = parseFloat(it.weight ?? it.product_weight ?? pkg.weight ?? pkg.product_weight ?? 0) || 0;
  const unit = String(it.weight_unit || pkg.weight_unit || (rawWeight > 0 && rawWeight < 50 ? 'kg' : 'g')).toLowerCase();
  
  const weightGrams = unit === 'kg' ? Math.round(rawWeight * 1000 * 100) / 100 : rawWeight;
  const weightKg = unit === 'kg' ? rawWeight : Math.round((rawWeight / 1000) * 1000) / 1000;

  let image = it.image_url || it.image || it.product_image || it.thumbnail_url || null;
  if (!image && Array.isArray(it.images) && it.images[0]) {
    image = typeof it.images[0] === 'string' ? it.images[0] : (it.images[0].url || it.images[0].src || null);
  }

  // Extract all barcodes
  const codes = new Set();
  const add = (v) => {
    if (v != null) {
      const s = String(v).trim();
      if (s && s !== 'null' && s !== 'undefined') codes.add(s);
    }
  };
  add(it.barcode);
  add(it.product_barcode);
  add(it.ean);
  add(it.upc);
  add(it.barcode_number);
  if (Array.isArray(it.barcodes)) {
    for (const b of it.barcodes) {
      if (typeof b === 'string' || typeof b === 'number') add(b);
      else if (b && typeof b === 'object') {
        add(b.barcode);
        add(b.code);
        add(b.value);
      }
    }
  }
  if (Array.isArray(it.package_configurations)) {
    for (const p of it.package_configurations) {
      add(p.barcode);
      add(p.product_barcode);
    }
  }

  const allBarcodes = Array.from(codes);
  const primaryBarcode = allBarcodes[0] || (it.barcode ? String(it.barcode).trim() : null);

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
    barcode: primaryBarcode,
    barcodes: allBarcodes,
    pkg_config: pkg
  };
}

let syncInProgress = false;

/**
 * Sync all inventory from Helm into local `helm_products` cache table.
 */
export async function syncHelmProducts({ force = false } = {}) {
  if (syncInProgress && !force) {
    return { status: 'already_running' };
  }
  if (!helmConfigured()) {
    return { error: 'Helm API not configured' };
  }

  syncInProgress = true;
  const startedAt = Date.now();
  let totalSaved = 0;
  let clientCount = 0;

  try {
    const custRes = await query(`SELECT id, helm_customer_id, business_name FROM customers WHERE helm_customer_id IS NOT NULL`);
    const customers = custRes.rows;

    for (const cust of customers) {
      clientCount++;
      try {
        const items = await fetchInventoryForClient({
          helmClientId: cust.helm_customer_id,
          perPage: 100,
          maxPages: 50,
          productTypes: [1, 4] // Inventory & Packaging
        });

        for (const it of items) {
          if (!it || !it.id) continue;
          const helmId = String(it.id);
          const phys = extractItemPhysicals(it);
          const sku = it.sku || it.product_sku || '';
          const name = it.name || it.title || it.product_name || 'Unnamed Product';
          const stock = parseInt(it.stock_level ?? it.quantity ?? 0) || 0;

          await query(`
            INSERT INTO helm_products (
              helm_id, sku, name, barcode, barcodes, image_url,
              customer_id, helm_customer_id, customer_name,
              length, width, height, dimension_unit,
              weight_g, weight_kg, raw_weight, raw_unit,
              stock_level, locations, package_configurations, raw_data,
              updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8, $9,
              $10, $11, $12, $13,
              $14, $15, $16, $17,
              $18, $19, $20, $21,
              NOW()
            )
            ON CONFLICT (helm_id) DO UPDATE SET
              sku = EXCLUDED.sku,
              name = EXCLUDED.name,
              barcode = COALESCE(EXCLUDED.barcode, helm_products.barcode),
              barcodes = EXCLUDED.barcodes,
              image_url = COALESCE(EXCLUDED.image_url, helm_products.image_url),
              customer_id = EXCLUDED.customer_id,
              helm_customer_id = EXCLUDED.helm_customer_id,
              customer_name = EXCLUDED.customer_name,
              length = EXCLUDED.length,
              width = EXCLUDED.width,
              height = EXCLUDED.height,
              dimension_unit = EXCLUDED.dimension_unit,
              weight_g = EXCLUDED.weight_g,
              weight_kg = EXCLUDED.weight_kg,
              raw_weight = EXCLUDED.raw_weight,
              raw_unit = EXCLUDED.raw_unit,
              stock_level = EXCLUDED.stock_level,
              locations = EXCLUDED.locations,
              package_configurations = EXCLUDED.package_configurations,
              raw_data = EXCLUDED.raw_data,
              updated_at = NOW()
          `, [
            helmId, sku, name, phys.barcode, phys.barcodes, phys.image_url,
            cust.id, String(cust.helm_customer_id), cust.business_name,
            phys.length, phys.width, phys.height, phys.dimension_unit,
            phys.weight_g, phys.weight_kg, phys.raw_weight, phys.raw_unit,
            stock, JSON.stringify(it.locations || []), JSON.stringify(it.package_configurations || []), JSON.stringify(it)
          ]);

          totalSaved++;
        }
      } catch (cErr) {
        console.warn(`[inventory-sync] Failed syncing customer ${cust.business_name}:`, cErr.message);
      }
    }

    console.log(`[inventory-sync] Completed. Synced ${totalSaved} products across ${clientCount} customers in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    return { ok: true, products_synced: totalSaved, customers: clientCount, duration_ms: Date.now() - startedAt };
  } catch (err) {
    console.error('[inventory-sync] Critical error during sync:', err.message);
    return { error: err.message };
  } finally {
    syncInProgress = false;
  }
}

/**
 * Instant local lookup by barcode ONLY.
 */
export async function findProductsByBarcode(rawBarcode) {
  const barcode = String(rawBarcode || '').trim();
  if (!barcode) return [];

  const clean = barcode.replace(/[^a-zA-Z0-9]/gi, '');

  // 1. Instant local database search (takes < 2ms)
  const { rows } = await query(`
    SELECT *
    FROM helm_products
    WHERE barcode = $1
       OR $1 = ANY(barcodes)
       OR (length($2) >= 5 AND regexp_replace(barcode, '[^a-zA-Z0-9]', '', 'g') = $2)
    ORDER BY name ASC
  `, [barcode, clean]);

  if (rows.length > 0) {
    return rows.map(r => ({
      id: r.helm_id,
      sku: r.sku,
      name: r.name,
      barcode: r.barcode,
      all_barcodes: r.barcodes || [],
      image_url: r.image_url,
      length: parseFloat(r.length) || 0,
      width: parseFloat(r.width) || 0,
      height: parseFloat(r.height) || 0,
      dimension_unit: r.dimension_unit || 'cm',
      weight_g: parseFloat(r.weight_g) || 0,
      weight_kg: parseFloat(r.weight_kg) || 0,
      raw_unit: r.raw_unit || 'g',
      stock_level: r.stock_level,
      locations: r.locations || [],
      customer_id: r.customer_id,
      helm_customer_id: r.helm_customer_id,
      customer_name: r.customer_name || 'Customer'
    }));
  }

  // 2. Direct fallback to Helm if not found locally
  if (helmConfigured()) {
    try {
      // Check if rawBarcode is a direct Helm product ID (e.g. 34993)
      if (/^\d+$/.test(barcode)) {
        try {
          const detailRes = await fetchInventoryDetail(barcode);
          const detail = detailRes?.data || detailRes;
          if (detail && detail.id) {
            const phys = extractItemPhysicals(detail);
            const custRes = await query(`SELECT id, helm_customer_id, business_name FROM customers WHERE helm_customer_id = $1`, [String(detail.fulfilment_client_id || detail.client_id || '')]);
            const cust = custRes.rows[0] || null;

            // Cache it locally
            await query(`
              INSERT INTO helm_products (
                helm_id, sku, name, barcode, barcodes, image_url,
                customer_id, helm_customer_id, customer_name,
                length, width, height, dimension_unit,
                weight_g, weight_kg, raw_weight, raw_unit,
                stock_level, raw_data, updated_at
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
              ON CONFLICT (helm_id) DO UPDATE SET
                barcode = COALESCE(EXCLUDED.barcode, helm_products.barcode),
                barcodes = EXCLUDED.barcodes,
                weight_g = EXCLUDED.weight_g,
                weight_kg = EXCLUDED.weight_kg,
                updated_at = NOW()
            `, [
              String(detail.id), detail.sku || '', detail.name || detail.title || '', phys.barcode || barcode, phys.barcodes.length ? phys.barcodes : [barcode], phys.image_url,
              cust?.id || null, String(detail.fulfilment_client_id || ''), cust?.business_name || 'Customer',
              phys.length, phys.width, phys.height, phys.dimension_unit,
              phys.weight_g, phys.weight_kg, phys.raw_weight, phys.raw_unit,
              parseInt(detail.stock_level ?? 0) || 0, JSON.stringify(detail)
            ]);

            return [{
              id: String(detail.id),
              sku: detail.sku || '',
              name: detail.name || detail.title || 'Unnamed Product',
              barcode: phys.barcode || barcode,
              all_barcodes: phys.barcodes,
              image_url: phys.image_url,
              length: phys.length,
              width: phys.width,
              height: phys.height,
              dimension_unit: phys.dimension_unit,
              weight_g: phys.weight_g,
              weight_kg: phys.weight_kg,
              raw_unit: phys.raw_unit,
              stock_level: detail.stock_level ?? 0,
              locations: detail.locations || [],
              customer_id: cust?.id || null,
              helm_customer_id: String(detail.fulfilment_client_id || ''),
              customer_name: cust?.business_name || 'Customer'
            }];
          }
        } catch {}
      }
    } catch (fallbackErr) {
      console.warn('[inventory-fallback] Helm fallback error:', fallbackErr.message);
    }
  }

  return [];
}
