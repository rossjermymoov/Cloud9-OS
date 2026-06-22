/**
 * Cloud9 OS — Storage footprint (m³ per client)
 *
 * Pulls each fulfilment client's inventory from Helm, reads package dimensions
 * (L×W×H + items-per-box) from the item detail, and computes the storage volume
 * each SKU occupies per location:  volume_m³ = stock × (L·W·H ÷ box_qty).
 * Helm dimensions are centimetres by default (STORAGE_DIM_UNIT to override).
 */

import { query } from '../db/index.js';
import { helmConfigured, fetchInventoryForClient } from './helmClient.js';

// Helm product dimensions are CENTIMETRES. cm³ → m³ = ÷1e6.
// Only an explicit 'mm' override changes this; anything else (including a stray
// 'm', or unset) resolves to cm. Previously 'm' divided by 1 and treated cm
// numbers as metres, inflating every volume by 1,000,000× (e.g. a 100×100×116cm
// SKU showed as 1,160,000 "m³" instead of 1.16 m³).
const DIM_UNIT = (process.env.STORAGE_DIM_UNIT || 'cm').toLowerCase();
const UNIT_DIVISOR = DIM_UNIT === 'mm' ? 1e9 : 1e6;
// A single physical unit over ~30 m³ (a >3.1 m cube) is a data error, not real
// stock — drop it so one bad dimension can't dominate a location/customer.
const MAX_UNIT_M3 = 30;

export function dimUnitInfo() {
  return { configured: process.env.STORAGE_DIM_UNIT || '(unset → cm)', effective_unit: DIM_UNIT === 'mm' ? 'mm' : 'cm', divisor: UNIT_DIVISOR };
}

const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

/** Per-single-unit volume in m³ from the item's own product dimensions. */
function unitVolumeM3(item) {
  const L = num(item.product_length), W = num(item.product_width), H = num(item.product_height);
  if (L > 0 && W > 0 && H > 0) {
    const v = (L * W * H) / UNIT_DIVISOR;
    return v > MAX_UNIT_M3 ? null : v;   // implausible single-unit volume → treat as no dims
  }
  return null;
}

export async function syncStorage({ pageDelayMs = 80 } = {}) {
  if (!helmConfigured()) return { error: 'Helm not configured' };

  let logId = null;
  try {
    const lr = await query(
      `INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('storage','running',0,$1) RETURNING id`,
      [`started storage sync at ${new Date().toISOString()}`]
    );
    logId = lr.rows[0]?.id || null;
  } catch (e) { console.warn('[storage-sync] start row:', e.message); }

  let lines = 0, skus = 0, noDims = 0, errors = 0, skippedNonStock = 0, cloud9Skus = 0;
  const seenIds = new Set();   // every inventory id touched, so the Cloud9 pass skips assigned stock

  // Write one storage line per stocked location for a single inventory item.
  // Skips Components (type 2) and Groups (type 3): a Group is a virtual bundle of
  // its components, and Components are the parts that make up a SKU — counting
  // either alongside the real stocked Inventory/Packaging would double-count.
  async function writeItemLines(it, customerId, helmClientId, isCloud9 = false) {
    const invId = it.id != null ? String(it.id) : null;
    if (!invId) return;
    seenIds.add(invId);
    // type: 1=Inventory, 2=Component, 3=Group, 4=Packaging, 5=Aux Packaging.
    const t = parseInt(it.type ?? it.product_type);
    if (t === 2 || t === 3) { skippedNonStock++; return; }
    skus++; if (isCloud9) cloud9Skus++;

    const unitM3 = unitVolumeM3(it);
    const hasDims = unitM3 != null && unitM3 > 0;
    if (!hasDims) noDims++;

    const locs = Array.isArray(it.locations) ? it.locations : [];
    await query(`DELETE FROM storage_lines WHERE helm_inventory_id = $1`, [invId]);
    const stocked = locs.filter(l => (parseInt(l.stock_level) || 0) > 0);
    const rows = stocked.length ? stocked : [{ location_id: null, location_name: null, warehouse_id: null, stock_level: it.stock_level }];
    for (const l of rows) {
      const qty = parseInt(l.stock_level) || 0;
      const vol = hasDims ? +(qty * unitM3).toFixed(4) : 0;
      await query(`
        INSERT INTO storage_lines
          (helm_inventory_id, sku, name, customer_id, helm_client_id, location_id, location_name,
           warehouse_id, qty, unit_m3, volume_m3, has_dimensions, computed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
        ON CONFLICT (helm_inventory_id, location_id) DO UPDATE SET
          sku=EXCLUDED.sku, name=EXCLUDED.name, customer_id=EXCLUDED.customer_id,
          helm_client_id=EXCLUDED.helm_client_id, location_name=EXCLUDED.location_name, warehouse_id=EXCLUDED.warehouse_id,
          qty=EXCLUDED.qty, unit_m3=EXCLUDED.unit_m3, volume_m3=EXCLUDED.volume_m3,
          has_dimensions=EXCLUDED.has_dimensions, computed_at=NOW()
      `, [
        invId, it.sku || null, it.name || null, customerId, helmClientId,
        l.location_id != null ? String(l.location_id) : null, l.location_name || null,
        l.warehouse_id != null ? parseInt(l.warehouse_id) : null,
        qty, hasDims ? +unitM3.toFixed(6) : 0, vol, hasDims,
      ]);
      lines++;
    }
  }

  try {
    // Full rebuild: wipe the table first so SKUs that are now excluded (Components/
    // Groups) or no longer in Helm don't leave stale rows inflating the totals.
    await query(`DELETE FROM storage_lines`);

    // Attribute to EVERY customer that has a Helm id — active or not. (Previously
    // only 'active' customers were looped, so an inactive customer's stock fell
    // through to the Cloud9 catch-all below and made Cloud9 look enormous.)
    const cm = await query(`SELECT id, helm_customer_id FROM customers WHERE helm_customer_id IS NOT NULL`);
    for (const c of cm.rows) {
      let items;
      try { items = await fetchInventoryForClient({ helmClientId: c.helm_customer_id }); }
      catch (e) { errors++; console.warn(`[storage-sync] list ${c.helm_customer_id}: ${e.message}`); continue; }
      for (const it of items) await writeItemLines(it, c.id, String(c.helm_customer_id));
    }

    // Cloud9-owned stock: any inventory item NOT returned for any fulfilment
    // client has no client assigned → it's ours (e.g. our packaging). Attribute
    // it to Cloud9 (customer_id NULL, shown as "Cloud9" in the breakdowns).
    try {
      const all = await fetchInventoryForClient({ helmClientId: null });
      for (const it of all) {
        const invId = it.id != null ? String(it.id) : null;
        if (!invId || seenIds.has(invId)) continue;
        await writeItemLines(it, null, null, true);
      }
    } catch (e) { errors++; console.warn(`[storage-sync] cloud9 pass: ${e.message}`); }

    const detail = `${lines} lines, ${skus} SKUs (${cloud9Skus} Cloud9), ${noDims} without dimensions, ${skippedNonStock} components/groups skipped, ${errors} errors`;
    if (logId) await query(`UPDATE helm_sync_log SET status='ok', records=$1, detail=$2, ran_at=NOW() WHERE id=$3`, [lines, detail, logId]);
    else await query(`INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('storage','ok',$1,$2)`, [lines, detail]);
    console.log('✅ storage sync complete:', detail);
    return { lines, skus, noDims, errors };
  } catch (err) {
    const msg = `${err.message} (${lines} lines before failing)`;
    if (logId) await query(`UPDATE helm_sync_log SET status='error', records=$1, detail=$2, ran_at=NOW() WHERE id=$3`, [lines, msg, logId]).catch(() => {});
    return { lines, error: err.message };
  }
}
