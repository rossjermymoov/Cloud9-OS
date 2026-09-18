/**
 * Cloud9 OS — Helm Inventory Cache & Synchronization Service
 *
 * Fast sub-millisecond barcode lookups and physical inventory (Type 1) sync.
 */

import { query } from '../db/index.js';
import { helmConfigured, fetchInventoryForClient, fetchInventoryDetail, authedGet } from './helmClient.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Recursively scans any object/array to extract all barcodes, EANs, UPCs, and GTINs.
 */
export function deepExtractBarcodes(obj, seen = new Set()) {
  const codes = new Set();
  const check = (v) => {
    if (v != null) {
      const s = String(v).trim();
      // True barcodes are at least 4 alphanumeric chars and not boolean/null
      if (s && s !== 'null' && s !== 'undefined' && s.length >= 4 && !/^\s*$/.test(s)) {
        codes.add(s);
      }
    }
  };

  function recurse(o, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 5) return;
    if (seen.has(o)) return;
    seen.add(o);

    if (Array.isArray(o)) {
      for (const item of o) recurse(item, depth + 1);
      return;
    }

    for (const [k, v] of Object.entries(o)) {
      const keyLower = k.toLowerCase();
      if (
        keyLower === 'barcode' ||
        keyLower.endsWith('_barcode') ||
        keyLower.startsWith('barcode_') ||
        keyLower === 'ean' ||
        keyLower === 'ean13' ||
        keyLower === 'ean8' ||
        keyLower.includes('ean') ||
        keyLower.includes('upc') ||
        keyLower.includes('gtin')
      ) {
        if (typeof v === 'string' || typeof v === 'number') {
          check(v);
        }
      }
      if (v && typeof v === 'object') {
        recurse(v, depth + 1);
      }
    }
  }

  recurse(obj);
  return Array.from(codes);
}

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

  // Extract all barcodes deeply from entire item structure
  const allBarcodes = deepExtractBarcodes(it);
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

export function cancelInventorySync() {
  syncState.inProgress = false;
  syncState.completedAt = new Date().toISOString();
}

/**
 * Determines whether a Helm inventory record is strictly Physical Inventory (Type 1).
 * Rejects Components (2), Groups/Bundles (3), Packaging (4, 5), and deleted/archived items.
 */
export function isPhysicalInventory(it) {
  if (!it || !it.id) return false;

  // Check type fields (can be integer, string, or object)
  let rawType = it.type ?? it.product_type ?? it.type_id ?? it.product_type_id;
  if (rawType && typeof rawType === 'object') {
    rawType = rawType.id ?? rawType.type ?? rawType.value;
  }

  if (typeof rawType === 'string' && isNaN(parseInt(rawType))) {
    const s = rawType.toLowerCase();
    if (s.includes('comp') || s.includes('group') || s.includes('bund') || s.includes('pack')) return false;
    if (s.includes('inv') || s.includes('prod') || s.includes('phys')) return true;
  }

  const t = parseInt(rawType);
  // In Helm: 1 = Physical Inventory, 2 = Component, 3 = Group/Bundle, 4 = Packaging, 5 = Aux Packaging
  if (!isNaN(t) && t !== 1) return false;

  // Check boolean and group flags
  if (it.is_bundle || it.is_group || it.is_component || it.is_packaging || it.is_auxiliary) return false;
  if (it.group_id != null && it.is_group) return false;
  if (it.parent_id != null && (it.is_component || it.is_child)) return false;
  if (it.status === 'archived' || it.status === 'inactive' || it.archived === true || it.is_active === false || it.deleted_at) return false;
  if (it.fulfilment_client?.status === 'inactive' || it.fulfilment_client?.status === 'archived') return false;

  return true;
}

/**
 * Bulk upsert physical inventory (Type 1 only) into helm_products in chunks of 100.
 */
async function bulkUpsertPhysicalProducts(items, custMap) {
  if (!items.length) return 0;
  const CHUNK_SIZE = 100;
  let count = 0;

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const valuePlaceholders = [];
    const values = [];

    chunk.forEach((it) => {
      if (!isPhysicalInventory(it)) return;

      const helmClientId = String(it.fulfilment_client_id || it.client_id || it.customer_id || '');
      const cust = custMap.get(helmClientId);
      
      // Strict constraint: Only sync products belonging to active customers
      if (!cust) return;

      const helmId = String(it.id);
      const phys = extractItemPhysicals(it);
      const sku = it.sku || it.product_sku || '';
      const name = it.name || it.title || it.product_name || 'Unnamed Product';
      const stock = parseInt(it.stock_level ?? it.quantity ?? 0) || 0;

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
        cust.id,
        cust.helm_customer_id || helmClientId,
        cust.business_name,
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
      `;
      await query(sql, values);
    }
  }

  return count;
}

/**
 * Reset database table and sync purely Physical Inventory (Type 1) from Helm.
 */
export async function syncHelmProducts({ force = false, truncate = false } = {}) {
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
    if (truncate) {
      console.log('[inventory-sync] Truncating helm_products table for clean reset...');
      await query(`TRUNCATE TABLE helm_products`);
    }

    // Only load active customers
    const custRes = await query(`
      SELECT id, helm_customer_id, business_name 
      FROM customers 
      WHERE helm_customer_id IS NOT NULL 
        AND (account_status IS NULL OR account_status = 'active')
    `);
    const custMap = new Map();
    for (const c of custRes.rows) {
      custMap.set(String(c.helm_customer_id), c);
    }

    // ── Single Global Sweep: Physical Inventory Only (Type 1) ──
    let page = 1;
    let globalPages = 0;
    const maxGlobalPages = 300;

    while (page <= maxGlobalPages) {
      if (!syncState.inProgress) {
        console.log('[inventory-sync] Sync cancelled by user.');
        break;
      }
      try {
        const res = await authedGet('/inventory', {
          'filters[product_types][]': 1,
          'filters[product_type][]': 1,
          limit: 100,
          page
        });
        const rows = res.data || [];
        if (rows.length === 0) break;

        const inserted = await bulkUpsertPhysicalProducts(rows, custMap);
        syncState.totalSaved += inserted;
        globalPages++;

        const lastPage = parseInt(res.last_page) || 1;
        const curPage = parseInt(res.current_page) || page;
        if (!res.next_page_url || curPage >= lastPage) break;
        page++;

        await sleep(50);
      } catch (pageErr) {
        console.warn(`[inventory-sync] Page ${page} warning:`, pageErr.message);
        await sleep(1000);
        page++;
      }
    }

    const { rows: finalCount } = await query(`SELECT COUNT(*)::int as total FROM helm_products`);
    const totalInDb = finalCount[0]?.total || syncState.totalSaved;

    syncState.inProgress = false;
    syncState.completedAt = new Date().toISOString();
    syncState.totalSaved = totalInDb;

    console.log(`[inventory-sync] Completed. Total physical inventory in helm_products: ${totalInDb} products in ${((Date.now() - startedTime) / 1000).toFixed(1)}s`);
    return { ok: true, products_synced: totalInDb, duration_ms: Date.now() - startedTime };
  } catch (err) {
    console.error('[inventory-sync] Sync failed:', err.message);
    syncState.inProgress = false;
    syncState.error = err.message;
    return { error: err.message };
  }
}

/**
 * Instant local lookup by barcode (or exact numeric Helm Product ID).
 * Runs strictly indexed lookups (< 1ms) and never matches unrelated items.
 */
export async function findProductsByBarcode(rawBarcode) {
  const queryTerm = String(rawBarcode || '').trim();
  if (!queryTerm) return [];

  // 1. Instant local database search — indexed direct barcode or Helm ID match (<1ms)
  const { rows } = await query(`
    SELECT *
    FROM helm_products
    WHERE (barcode IS NOT NULL AND barcode = $1)
       OR ($1 = ANY(barcodes))
       OR (helm_id = $1 AND $1 ~ '^[0-9]+$')
    ORDER BY name ASC
    LIMIT 20
  `, [queryTerm]);

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

  // 2. Direct fallback into Helm API ONLY if query is an exact numeric Helm product ID (e.g. 34993)
  if (helmConfigured() && /^\d+$/.test(queryTerm)) {
    try {
      const detailRes = await fetchInventoryDetail(queryTerm);
      const detail = detailRes?.data || detailRes;
      if (detail && String(detail.id) === queryTerm && isPhysicalInventory(detail)) {
        const custRes = await query(`
          SELECT id, helm_customer_id, business_name 
          FROM customers 
          WHERE helm_customer_id IS NOT NULL 
            AND (account_status IS NULL OR account_status = 'active')
        `);
        const custMap = new Map();
        for (const c of custRes.rows) {
          custMap.set(String(c.helm_customer_id), c);
        }

        const helmClientId = String(detail.fulfilment_client_id || detail.client_id || '');
        const cust = custMap.get(helmClientId);
        if (cust) {
          const phys = extractItemPhysicals(detail);
          return [{
            id: String(detail.id),
            sku: detail.sku || '',
            name: detail.name || detail.title || 'Unnamed Product',
            barcode: phys.barcode,
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
            customer_id: cust.id,
            helm_customer_id: helmClientId,
            customer_name: cust.business_name
          }];
        }
      }
    } catch (fallbackErr) {
      console.warn('[inventory-fallback] Helm numeric ID lookup error:', fallbackErr.message);
    }
  }

  return [];
}
