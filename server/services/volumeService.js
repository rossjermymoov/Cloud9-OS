/**
 * Cloud9 OS — Volume service
 *
 * The `orders` table is the source of truth for dispatch volume. Webhooks and
 * the Helm pull sync both upsert orders here; daily snapshots are recomputed
 * from it so parcels reflect the REAL per-order parcel count.
 */

import { query } from '../db/index.js';

const DISPATCH_STATUS_IDS = new Set([5, 81]); // Despatched, Partially Shipped

function cleanDate(d) {
  if (!d) return null;
  const s = String(d);
  if (s.startsWith('0000')) return null;
  return s;
}

/**
 * Count parcels on a Helm order object, trying the shapes a webhook/order may
 * carry. Returns null when genuinely unknown (caller decides a fallback).
 */
export function pickParcelCount(o) {
  if (Array.isArray(o.shipment) && o.shipment.length) {
    let n = 0;
    for (const s of o.shipment) {
      if (Array.isArray(s.parcels)) n += s.parcels.length;
      else if (s.parcel_count != null) n += parseInt(s.parcel_count) || 0;
      else n += 1;
    }
    if (n > 0) return n;
  }
  if (Array.isArray(o.parcels))            return o.parcels.length;
  if (Array.isArray(o.tracking_codes))     return o.tracking_codes.length;
  if (Array.isArray(o.create_label_parcels)) return o.create_label_parcels.length;
  if (o.parcel_count != null)              return parseInt(o.parcel_count) || 0;
  if (o.total_parcels != null)             return parseInt(o.total_parcels) || 0;
  return null;
}

/**
 * Normalise a raw Helm order (from a webhook body or the orders API) into the
 * shape upsertOrder expects. `helmClientId` may be supplied when the caller
 * already knows the fulfilment client (e.g. the pull sync queried by it).
 */
export function normaliseOrder(raw, { helmClientId = null, parcelFloor = 0, forceDispatched = false } = {}) {
  const o = raw.order || raw;
  const parcels = pickParcelCount(o);
  // Shipped time (order-dispatched / order-shipped webhook) — try the common names.
  const dispatched = cleanDate(o.date_dispatched ?? o.dispatched_at ?? o.date_despatched ?? o.despatched_at ?? o.shipped_at ?? o.date_shipped);
  const statusId = o.status_id != null ? parseInt(o.status_id) : null;
  const isDispatched = forceDispatched || !!dispatched || (statusId != null && DISPATCH_STATUS_IDS.has(statusId));

  return {
    helm_order_id:    o.id != null ? String(o.id) : null,
    channel_order_id: o.channel_order_id || null,
    helm_client_id:   String(o.fulfilment_client_id ?? o.fulfilmentClientId ?? o.client_id ?? helmClientId ?? '') || null,
    status_id:        statusId,
    status_label:     o.status || o.status_label || null,
    sale_type:        o.sale_type || null,
    item_count:       parseInt(o.total_inventory_quantity ?? o.item_quantity ?? o.items) || 0,
    parcel_count:     parcels != null ? parcels : (isDispatched ? Math.max(parcelFloor, 0) : 0),
    total_weight:     o.total_weight != null ? parseFloat(o.total_weight) : null,
    channel_id:       o.channel_id != null ? parseInt(o.channel_id) : null,
    // Created/received time (order-created webhook) — try the common names.
    received_at:      cleanDate(o.date_received ?? o.received_at ?? o.created_at ?? o.date_created ?? o.order_date),
    // If despatched but no explicit date, stamp now so it counts for today.
    dispatched_at:    dispatched || (isDispatched ? new Date().toISOString() : null),
    raw:              o,
  };
}

/**
 * Recompute one customer/day snapshot. Volume is sourced from `shipments`
 * (Voila is the source of truth for parcels), summing the REAL per-shipment
 * parcel + item counts for that collection date.
 */
export async function recomputeSnapshot(customerId, day) {
  if (!customerId || !day) return;
  const { rows } = await query(`
    SELECT COALESCE(SUM(parcel_count),0)::int AS parcels,
           COALESCE(SUM(item_count),0)::int   AS items
    FROM shipments
    WHERE customer_id = $1 AND cancelled = false AND dispatched_at = $2::date
  `, [customerId, day]);
  const { parcels, items } = rows[0];
  await query(`
    INSERT INTO customer_volume_snapshots (customer_id, snapshot_date, parcel_count, item_count)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (customer_id, snapshot_date) DO UPDATE SET
      parcel_count = EXCLUDED.parcel_count,
      item_count   = EXCLUDED.item_count
  `, [customerId, day, parcels, items]);
}

// ─── Voila shipment volume (the real parcel + item source) ───────────────────
function parseRS(rs) {
  if (typeof rs === 'string') { try { rs = JSON.parse(rs); } catch { rs = {}; } }
  return rs && typeof rs === 'object' ? rs : {};
}

/** Parcels = number of parcels in the shipment (one entry per parcel). */
export function countShipmentParcels(shipment, rs) {
  if (Array.isArray(shipment?.create_label_parcels) && shipment.create_label_parcels.length) return shipment.create_label_parcels.length;
  if (Array.isArray(rs?.parcels) && rs.parcels.length) return rs.parcels.length;
  if (shipment?.parcel_count != null) return parseInt(shipment.parcel_count) || 0;
  return 0;
}

/** Items = sum of every item quantity across every parcel. */
export function countShipmentItems(rs) {
  let n = 0;
  for (const p of (rs?.parcels || [])) {
    for (const it of (p.items || [])) n += parseInt(it.quantity ?? it.qty ?? 1) || 0;
  }
  return n;
}

/**
 * Record one Voila shipment (from a webhook) into the shipments table — keyed
 * by Voila shipment id so repeated tracking updates never double-count — and
 * refresh that customer's daily volume snapshot. Customer is resolved by
 * accounts_id → helm_accounts_id.
 */
export async function recordVoilaShipment(body) {
  const json = (body && body.json && typeof body.json === 'object') ? body.json : (body || {});
  const shipment = json.shipment || {};
  const tu = json.tracking_update || {};
  const shipmentId = shipment.id ?? tu.shipment_id;
  if (shipmentId == null) return null;

  const rs = parseRS(shipment.request_shipment ?? json.request_shipment);
  const accountsId = rs.accounts_id || shipment.account_name || rs.ship_from?.company_name || shipment.account_number || null;

  let customerId = null;
  if (accountsId) {
    const cr = await query(
      `SELECT id FROM customers WHERE helm_accounts_id = $1 OR account_number = $1 OR helm_customer_id = $1 LIMIT 1`,
      [String(accountsId).trim()]
    );
    customerId = cr.rows[0]?.id || null;
  }

  const parcels  = countShipmentParcels(shipment, rs);
  const items    = countShipmentItems(rs);
  const cl       = Array.isArray(shipment.create_label_parcels) ? shipment.create_label_parcels : [];
  const tracking = [...new Set(cl.map(p => p.tracking_code).filter(Boolean))];
  const collectionDate = shipment.collection_date || tu.collection_date || tu.received_date || null;
  // Despatch date = when the shipment/label was created. This is the day the
  // volume is counted on (collection dates are often null or forward-dated).
  const despatched = shipment.created_at || shipment.date_created || rs.collection_date || collectionDate || tu.received_date || null;
  const day = despatched ? String(despatched).slice(0, 10) : null;

  await query(`
    INSERT INTO shipments
      (helm_shipment_id, customer_id, customer_account, courier, reference,
       ship_to_name, ship_to_postcode, ship_to_country_iso, parcel_count, item_count,
       collection_date, dispatched_at, tracking_codes, cancelled, raw_payload)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (helm_shipment_id) DO UPDATE SET
      customer_id      = COALESCE(EXCLUDED.customer_id, shipments.customer_id),
      customer_account = COALESCE(EXCLUDED.customer_account, shipments.customer_account),
      courier          = COALESCE(EXCLUDED.courier, shipments.courier),
      parcel_count     = EXCLUDED.parcel_count,
      item_count       = EXCLUDED.item_count,
      collection_date  = COALESCE(EXCLUDED.collection_date, shipments.collection_date),
      dispatched_at    = COALESCE(EXCLUDED.dispatched_at, shipments.dispatched_at),
      tracking_codes   = COALESCE(EXCLUDED.tracking_codes, shipments.tracking_codes),
      cancelled        = EXCLUDED.cancelled,
      updated_at       = NOW()
  `, [
    String(shipmentId), customerId, accountsId, shipment.courier || null, shipment.reference || null,
    shipment.ship_to_name || null, shipment.ship_to_postcode || null, shipment.ship_to_country_iso || null,
    parcels, items, collectionDate ? String(collectionDate).slice(0, 10) : null, day,
    tracking.length ? tracking : null, !!shipment.cancelled, JSON.stringify(shipment).slice(0, 200000),
  ]);

  if (customerId && day) await recomputeSnapshot(customerId, day);
  return { customerId, day, parcels, items, shipmentId: String(shipmentId), accountsId, resolved: !!customerId };
}

/**
 * Upsert a normalised order and refresh the affected daily snapshot.
 * Returns { customerId, day }.
 */
export async function upsertOrder(n) {
  if (!n.helm_order_id) return { customerId: null, day: null };

  let customerId = null;
  if (n.helm_client_id) {
    const r = await query('SELECT id FROM customers WHERE helm_customer_id = $1', [n.helm_client_id]);
    customerId = r.rows[0]?.id || null;
  }

  await query(`
    INSERT INTO orders
      (helm_order_id, channel_order_id, customer_id, helm_client_id, status_id, status_label,
       sale_type, item_count, parcel_count, total_weight, channel_id, received_at, dispatched_at, raw_payload)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    ON CONFLICT (helm_order_id) DO UPDATE SET
      channel_order_id = COALESCE(EXCLUDED.channel_order_id, orders.channel_order_id),
      customer_id      = COALESCE(EXCLUDED.customer_id, orders.customer_id),
      helm_client_id   = COALESCE(EXCLUDED.helm_client_id, orders.helm_client_id),
      status_id        = EXCLUDED.status_id,
      status_label     = EXCLUDED.status_label,
      item_count       = EXCLUDED.item_count,
      parcel_count     = EXCLUDED.parcel_count,
      total_weight     = COALESCE(EXCLUDED.total_weight, orders.total_weight),
      channel_id       = COALESCE(EXCLUDED.channel_id, orders.channel_id),
      received_at      = COALESCE(EXCLUDED.received_at, orders.received_at),
      dispatched_at    = COALESCE(EXCLUDED.dispatched_at, orders.dispatched_at),
      raw_payload      = EXCLUDED.raw_payload,
      updated_at       = NOW()
  `, [
    n.helm_order_id, n.channel_order_id, customerId, n.helm_client_id, n.status_id, n.status_label,
    n.sale_type, n.item_count, n.parcel_count, n.total_weight, n.channel_id, n.received_at, n.dispatched_at,
    JSON.stringify(n.raw || {}),
  ]);

  const day = n.dispatched_at ? String(n.dispatched_at).slice(0, 10) : null;
  if (customerId && day) await recomputeSnapshot(customerId, day);
  return { customerId, day };
}
