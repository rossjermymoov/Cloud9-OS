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
  const dispatched = cleanDate(o.date_dispatched ?? o.dispatched_at);
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
    received_at:      cleanDate(o.date_received ?? o.received_at),
    // If despatched but no explicit date, stamp now so it counts for today.
    dispatched_at:    dispatched || (isDispatched ? new Date().toISOString() : null),
    raw:              o,
  };
}

/** Recompute one customer/day snapshot from the orders table. */
export async function recomputeSnapshot(customerId, day) {
  if (!customerId || !day) return;
  const { rows } = await query(`
    SELECT COALESCE(SUM(parcel_count),0)::int AS parcels,
           COALESCE(SUM(item_count),0)::int   AS items
    FROM orders
    WHERE customer_id = $1 AND dispatched_at IS NOT NULL AND dispatched_at::date = $2::date
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
