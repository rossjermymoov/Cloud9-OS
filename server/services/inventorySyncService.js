/**
 * Cloud9 OS — Helm Inventory Cache & Synchronization Service
 *
 * Fast sub-millisecond barcode lookups and scheduled background inventory caching.
 */

import { query } from '../db/index.js';
import { helmConfigured, fetchInventoryForClient, fetchInventoryDetail, authedGet } from './helmClient.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

let syncState = {
  inProgress: false,
  totalSaved: 0,
  startedAt: null,
  completedAt: null,
  error: null
};

export function getSyncProgress() {
  return syncState;
}

/**
 * Bulk upsert items into helm_products in chunks of 100 for high database performance.
 */
async function bulkUpsertProducts(items, custMap) {
  if (!items.length) return 0;
  const CHUNK_SIZE = 100;
  let count = 0;

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const valuePlaceholders = [];
    const values = [];

    chunk.forEach((it, idx) => {
      if (!it || !it.id) return;
      const helmId = String(it.id);
      const phys = extractItemPhysicals(it);
      const sku = it.sku || it.product_sku || '';
      const name = it.name || it.title || it.product_name || 'Unnamed Product';
      const stock = parseInt(it.stock_level ?? it.quantity ?? 0) || 0;
      const helmClientId = String(it.fulfilment_client_id || it.client_id || it.customer_id || '');
      const cust = custMap.get(helmClientId) || null;

      const offset = values.length;
      valuePlaceholders.push(`(
        $${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6},
        $${offset + 7}, $${offset + 8}, $${offset + 9},
        $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13},
        $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17},
        $${offset + 18}, $${offset + 19}, $${offset + 20}, $${offset + 21},
        NOW()
      )`);

      values.push(
        helmId,
        sku,
        name,
        phys.barcode,
        phys.barcodes,
        phys.image_url,
        cust ? cust.id : null,
        helmClientId || (cust ? cust.helm_customer_id : null),
        cust ? cust.business_name : (it.fulfilment_client?.name || `Customer #${helmClientId || 'Unknown'}`),
        phys.length,
        phys.width,
        phys.height,
        phys.dimension_unit,
        phys.weight_g,
        phys.weight_kg,
        phys.raw_weight,
        phys.raw_unit,
        stock,
        JSON.stringify(it.locations || []),
        JSON.stringify(it.package_configurations || []),
        JSON.stringify(it)
      );
      count++;
    });

    if (valuePlaceholders.length > 0) {
      const sql = `
        INSERT INTO helm_products (
          helm_id, sku, name, barcode, barcodes, image_url,
          customer_id, helm_customer_id, customer_name,
          length, width, height, dimension_unit,
          weight_g, weight_kg, raw_weight, raw_unit,
          stock_level, locations, package_configurations, raw_data,
          updated_at
        ) VALUES ${valuePlaceholders.join(', ')}
        ON CONFLICT (helm_id) DO UPDATE SET
          sku = EXCLUDED.sku,
          name = EXCLUDED.name,
          barcode = COALESCE(EXCLUDED.barcode, helm_products.barcode),
          barcodes = EXCLUDED.barcodes,
          image_url = COALESCE(EXCLUDED.image_url, helm_products.image_url),
          customer_id = COALESCE(EXCLUDED.customer_id, helm_products.customer_id),
          helm_customer_id = COALESCE(EXCLUDED.helm_customer_id, helm_products.helm_customer_id),
          customer_name = COALESCE(EXCLUDED.customer_name, helm_products.customer_name),
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
      `;
      await query(sql, values);
    }
  }

  return count;
}

/**
 * Sync all inventory from Helm into local `helm_products` cache table.
 */
export async function syncHelmProducts({ force = false } = {}) {
  if (syncState.inProgress && !force) {
    return { status: 'already_running', total: syncState.totalSaved };
  }
  if (!helmConfigured()) {
    return { error: 'Helm API not configured' };
  }

  syncState = {
    inProgress: true,
    totalSaved: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null
  };

  const startedTime = Date.now();

  try {
    const custRes = await query(`SELECT id, helm_customer_id, business_name FROM customers WHERE helm_customer_id IS NOT NULL`);
    const custMap = new Map();
    for (const c of custRes.rows) {
      custMap.set(String(c.helm_customer_id), c);
    }

    // ── Strategy 1: Global Paged Sweep across Helm (all types, all customers) ──
    let page = 1;
    let globalPages = 0;
    const maxGlobalPages = 500; // supports up to 50,000 items

    while (page <= maxGlobalPages) {
      try {
        const res = await authedGet('/inventory', { page, per_page: 100 });
        const rows = res.data || [];
        if (rows.length === 0) break;

        await bulkUpsertProducts(rows, custMap);
        syncState.totalSaved += rows.length;
        globalPages++;

        const lastPage = parseInt(res.last_page) || 1;
        const curPage = parseInt(res.current_page) || page;
        if (!res.next_page_url || curPage >= lastPage) break;
        page++;

        await sleep(50); // safe pacing against rate limits
      } catch (pageErr) {
        console.warn(`[inventory-sync] Global page ${page} warning:`, pageErr.message);
        await sleep(1000);
        page++;
      }
    }

    console.log(`[inventory-sync] Global pass completed: ${syncState.totalSaved} items in ${globalPages} pages.`);

    // ── Strategy 2: Sweep each customer to ensure 100% full coverage ──
    for (const cust of custRes.rows) {
      try {
        let custPage = 1;
        while (custPage <= 100) {
          const res = await authedGet('/inventory', {
            'filters[fulfilment_clients][]': cust.helm_customer_id,
            page: custPage,
            per_page: 100
          });
          const rows = res.data || [];
          if (rows.length === 0) break;

          await bulkUpsertProducts(rows, custMap);
          syncState.totalSaved += rows.length;

          const lastPage = parseInt(res.last_page) || 1;
          const curPage = parseInt(res.current_page) || custPage;
          if (!res.next_page_url || curPage >= lastPage) break;
          custPage++;

          await sleep(50);
        }
      } catch (cErr) {
        console.warn(`[inventory-sync] Client sweep for ${cust.business_name}:`, cErr.message);
      }
    }

    // Get final count from database
    const { rows: finalCount } = await query(`SELECT COUNT(*)::int as total FROM helm_products`);
    const totalInDb = finalCount[0]?.total || syncState.totalSaved;

    syncState.inProgress = false;
    syncState.completedAt = new Date().toISOString();
    syncState.totalSaved = totalInDb;

    console.log(`[inventory-sync] Final total in helm_products: ${totalInDb} products in ${((Date.now() - startedTime) / 1000).toFixed(1)}s`);
    return { ok: true, products_synced: totalInDb, duration_ms: Date.now() - startedTime };
  } catch (err) {
    console.error('[inventory-sync] Sync failed:', err.message);
    syncState.inProgress = false;
    syncState.error = err.message;
    return { error: err.message };
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
