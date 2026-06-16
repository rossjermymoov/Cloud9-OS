/**
 * Cloud9 OS — Tracking status engine
 *
 * Status normalisation + payload parsing + parcel/event upsert.
 * Copied from Moov OS tracking.js (the proven engine the tracking page
 * relies on) with the billing/charge-verification coupling removed —
 * Cloud9 ingests tracking from Helm webhooks, not Voila.
 */

import { query } from '../db/index.js';

// ─── Status normalisation ─────────────────────────────────────────────────────
const STATUS_MAP = {
  // DPD numeric status codes
  '1':  'booked', '2':  'collected', '3':  'at_depot', '4':  'in_transit',
  '5':  'out_for_delivery', '6':  'failed_delivery', '7':  'delivered',
  '8':  'on_hold', '9':  'exception', '10': 'returned', '11': 'tracking_expired',
  '12': 'cancelled', '13': 'awaiting_collection', '16': 'damaged', '18': 'customs_hold',

  booked: 'booked', created: 'booked', label_created: 'booked',
  label_printed: 'booked', manifested: 'booked', registered: 'booked',

  collected: 'collected', collection: 'collected', picked_up: 'collected',
  collection_made: 'collected', collected_from_sender: 'collected',

  in_transit: 'in_transit', transit: 'in_transit', on_its_way: 'in_transit',
  forwarded: 'in_transit', processed: 'in_transit', departed_depot: 'in_transit',
  despatched: 'in_transit', dispatched: 'in_transit',
  left_hub: 'in_transit', parcel_left_hub: 'in_transit', departed_hub: 'in_transit',
  left_depot: 'in_transit', departed_facility: 'in_transit', left_facility: 'in_transit',

  at_hub: 'at_depot', hub: 'at_depot', in_depot: 'at_depot',
  arrived_at_depot: 'at_depot', at_depot: 'at_depot',
  sorting: 'at_depot', sorted: 'at_depot', at_facility: 'at_depot',
  arrived_at_hub: 'at_depot', held_at_hub: 'at_depot',
  parcel_at_hub: 'at_depot', received_at_hub: 'at_depot',

  out_for_delivery: 'out_for_delivery', out_for_del: 'out_for_delivery',
  on_vehicle: 'out_for_delivery', with_driver: 'out_for_delivery',
  loaded_on_van: 'out_for_delivery', with_courier: 'out_for_delivery',
  on_delivery_run: 'out_for_delivery',

  delivered: 'delivered', delivery_complete: 'delivered',
  signed_for: 'delivered', parcel_delivered: 'delivered',
  delivered_to_neighbour: 'delivered', delivered_to_safe_place: 'delivered',

  failed_delivery: 'failed_delivery', delivery_failed: 'failed_delivery',
  missed: 'failed_delivery', attempted: 'failed_delivery', not_delivered: 'failed_delivery',

  on_hold: 'on_hold', held: 'on_hold', hold: 'on_hold',
  exception: 'exception', address_issue: 'exception', address_query: 'exception',
  returned: 'returned', return_to_sender: 'returned', rts: 'returned',
  tracking_expired: 'tracking_expired', expired: 'tracking_expired',
  cancelled: 'cancelled', canceled: 'cancelled', void: 'cancelled',
  awaiting_collection: 'awaiting_collection', ready_for_collection: 'awaiting_collection',
  damaged: 'damaged',
  customs_hold: 'customs_hold', customs: 'customs_hold', held_in_customs: 'customs_hold',
};

// Statuses that confirm physical movement.
export const VERIFIED_STATUSES = new Set([
  'in_transit', 'at_depot', 'out_for_delivery', 'delivered', 'failed_delivery',
  'on_hold', 'awaiting_collection', 'customs_hold', 'exception', 'returned',
]);

export function normaliseStatus(raw) {
  if (!raw) return 'unknown';
  const exact = STATUS_MAP[String(raw)];
  if (exact) return exact;
  const key = String(raw).toLowerCase().replace(/[\s\-]+/g, '_').replace(/[^a-z_]/g, '');
  return STATUS_MAP[key] || 'unknown';
}

// request_shipment may arrive as a JSON string or an object; return it parsed.
function parseRequestShipment(rs) {
  if (typeof rs === 'string') { try { rs = JSON.parse(rs); } catch { rs = {}; } }
  return rs && typeof rs === 'object' ? rs : {};
}

function pick(obj, ...keys) {
  for (const k of keys) {
    const val = k.split('.').reduce((o, p) => (o && o[p] !== undefined ? o[p] : undefined), obj);
    if (val !== undefined && val !== null && val !== '') return val;
  }
  return null;
}

// ─── Normalise a raw webhook payload into a flat array of events ──────────────
// Supports the nested tracking_update.parcels shape and simple flat objects.
export function normalisePayload(body) {
  const payload = (body.json && typeof body.json === 'object') ? body.json : body;

  if (payload.tracking_update && Array.isArray(payload.tracking_update.parcels)) {
    const tu       = payload.tracking_update;
    const shipment = payload.shipment || {};
    const rs       = parseRequestShipment(shipment.request_shipment ?? payload.request_shipment);
    // Voila identifies the customer by accounts_id (e.g. "BEDDOES LTD") inside
    // request_shipment — this maps to a Cloud9 customer's helm_accounts_id.
    const accountsId = rs.accounts_id || shipment.accounts_id || shipment.account_name
                      || rs.ship_from?.company_name || shipment.account_number || null;
    const events   = [];

    for (const parcel of tu.parcels) {
      const consignment = parcel.tracking_code || parcel.trackingCode;
      if (!consignment) continue;

      const trackingEvents = parcel.tracking_events || parcel.trackingEvents || [{}];
      const sorted = [...trackingEvents].sort((a, b) => {
        const ta = new Date(a.update_date || a.timestamp || 0).getTime();
        const tb = new Date(b.update_date || b.timestamp || 0).getTime();
        return ta - tb;
      });

      for (const ev of sorted) {
        events.push({
          _consignment:        consignment,
          _shipment_reference: shipment.reference || null,
          _courier_name:       shipment.courier || null,
          _courier_code:       shipment.courier ? shipment.courier.toLowerCase() : null,
          _service_name:       shipment.friendly_service_name || null,
          _accounts_id:        accountsId,
          _customer_name:      shipment.account_name || rs.ship_from?.company_name || accountsId || null,
          _customer_account:   shipment.account_number || accountsId || null,
          _recipient_name:     shipment.ship_to_name || shipment.ship_to_company_name || rs.ship_to?.name || null,
          _recipient_postcode: shipment.ship_to_postcode || tu.address_information?.postcode || rs.ship_to?.postcode || null,
          _recipient_address:  shipment.ship_to_address || rs.ship_to?.address_1 || null,
          _weight_kg:          parcel.weight || null,
          _estimated_delivery: tu.expected_delivery || shipment.tracking_expected_delivery_date || null,
          _tracking_url:       parcel.tracking_url || parcel.trackingUrl || null,
          _raw:                ev,
          status:              ev.status_code != null ? String(ev.status_code) : (ev.status || null),
          status_description:  ev.status_description || ev.status || null,
          location:            ev.location || null,
          timestamp:           ev.update_date || null,
          event_code:          ev.update_id != null ? String(ev.update_id) : null,
        });
      }
    }
    return events;
  }

  return Array.isArray(payload) ? payload : [payload];
}

// ─── Upsert a single event → parcels + tracking_events ────────────────────────
export async function upsertEvent(event) {
  const consignment = event._consignment || pick(event,
    'consignment_number', 'consignmentNumber', 'tracking_number', 'trackingNumber',
    'tracking_code', 'trackingCode', 'reference', 'barcode', 'parcel_id', 'shipment_id', 'id'
  );
  if (!consignment) return { skipped: true, reason: 'no consignment number' };

  const rawStatus   = event.status || pick(event, 'event_type', 'event_code', 'eventType', 'state', 'type');
  const status      = normaliseStatus(rawStatus);
  const description = event.status_description || pick(event,
    'description', 'event_description', 'message', 'detail', 'text', 'statusDescription');
  const location    = event.location || pick(event, 'depot', 'hub', 'facility', 'scan_location', 'scanLocation');
  const eventAt     = event.timestamp || pick(event,
    'event_time', 'eventTime', 'datetime', 'date_time', 'scanned_at', 'created_at') || new Date().toISOString();
  const eventCode   = event.event_code || pick(event, 'eventCode', 'code', 'status_code', 'update_id');

  const courierName    = event._courier_name    || pick(event, 'courier_name', 'courierName', 'courier', 'carrier', 'carrier_name');
  const courierCode    = event._courier_code    || pick(event, 'courier_code', 'courierCode', 'carrier_code', 'carrierCode');
  const serviceName    = event._service_name    || pick(event, 'service', 'service_name', 'serviceName', 'product', 'service_type');
  const customerName   = event._customer_name   || pick(event, 'customer.name', 'customer_name', 'customerName', 'sender', 'sender_name', 'account_name');
  const customerAccount= event._customer_account|| pick(event, 'customer.account_number', 'account_number', 'accountNumber');
  const recipientName  = event._recipient_name  || pick(event, 'recipient.name', 'recipient_name', 'recipientName', 'consignee', 'delivery_name');
  const recipientPost  = event._recipient_postcode || pick(event, 'recipient.postcode', 'postcode', 'delivery_postcode', 'recipientPostcode', 'zip');
  const recipientAddr  = event._recipient_address  || pick(event, 'recipient.address', 'address', 'delivery_address', 'recipientAddress');
  const weightKg       = event._weight_kg       || pick(event, 'weight_kg', 'weightKg', 'weight', 'gross_weight');
  const estDelivery    = event._estimated_delivery || pick(event, 'estimated_delivery', 'estimatedDelivery', 'eta', 'due_date');
  const trackingUrl    = event._tracking_url    || pick(event, 'tracking_url', 'trackingUrl', 'track_url', 'parcel_tracking_url');

  // Resolve the customer. Voila identifies them by accounts_id (e.g. "BEDDOES LTD")
  // which maps to a Cloud9 customer's helm_accounts_id. Fall back to account number.
  const accountsId = event._accounts_id || pick(event, 'accounts_id', 'accountsId') || customerAccount;
  let customerId = null;
  if (accountsId) {
    const cr = await query(
      `SELECT id FROM customers WHERE helm_accounts_id = $1 OR account_number = $1 OR helm_customer_id = $1 LIMIT 1`,
      [String(accountsId).trim()]
    );
    if (cr.rows.length) customerId = cr.rows[0].id;
  }

  const parcelRes = await query(`
    INSERT INTO parcels
      (consignment_number, courier_name, courier_code, service_name,
       customer_id, customer_name, customer_account,
       recipient_name, recipient_postcode, recipient_address,
       weight_kg, estimated_delivery, tracking_url,
       status, status_description, last_location, last_event_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    ON CONFLICT (consignment_number) DO UPDATE SET
      courier_name       = COALESCE(EXCLUDED.courier_name,       parcels.courier_name),
      courier_code       = COALESCE(EXCLUDED.courier_code,       parcels.courier_code),
      service_name       = COALESCE(EXCLUDED.service_name,       parcels.service_name),
      customer_id        = COALESCE(EXCLUDED.customer_id,        parcels.customer_id),
      customer_name      = COALESCE(EXCLUDED.customer_name,      parcels.customer_name),
      customer_account   = COALESCE(EXCLUDED.customer_account,   parcels.customer_account),
      recipient_name     = COALESCE(EXCLUDED.recipient_name,     parcels.recipient_name),
      recipient_postcode = COALESCE(EXCLUDED.recipient_postcode, parcels.recipient_postcode),
      recipient_address  = COALESCE(EXCLUDED.recipient_address,  parcels.recipient_address),
      weight_kg          = COALESCE(EXCLUDED.weight_kg,          parcels.weight_kg),
      estimated_delivery = COALESCE(EXCLUDED.estimated_delivery, parcels.estimated_delivery),
      tracking_url       = COALESCE(EXCLUDED.tracking_url,       parcels.tracking_url),
      status             = CASE
                             WHEN parcels.status = 'delivered'   THEN parcels.status
                             WHEN EXCLUDED.last_event_at IS NULL THEN parcels.status
                             WHEN parcels.last_event_at IS NULL  THEN EXCLUDED.status
                             WHEN EXCLUDED.last_event_at >= parcels.last_event_at THEN EXCLUDED.status
                             ELSE parcels.status
                           END,
      status_description = CASE
                             WHEN parcels.status = 'delivered'   THEN parcels.status_description
                             WHEN EXCLUDED.last_event_at IS NULL THEN parcels.status_description
                             WHEN parcels.last_event_at IS NULL  THEN EXCLUDED.status_description
                             WHEN EXCLUDED.last_event_at >= parcels.last_event_at THEN EXCLUDED.status_description
                             ELSE parcels.status_description
                           END,
      last_location      = CASE
                             WHEN EXCLUDED.last_event_at IS NULL THEN parcels.last_location
                             WHEN parcels.last_event_at IS NULL  THEN EXCLUDED.last_location
                             WHEN EXCLUDED.last_event_at >= parcels.last_event_at THEN EXCLUDED.last_location
                             ELSE parcels.last_location
                           END,
      last_event_at      = GREATEST(EXCLUDED.last_event_at, parcels.last_event_at),
      delivered_at       = CASE WHEN EXCLUDED.status = 'delivered' AND EXCLUDED.last_event_at >= COALESCE(parcels.last_event_at, '-infinity') THEN EXCLUDED.last_event_at ELSE parcels.delivered_at END,
      updated_at         = NOW()
    RETURNING id
  `, [
    consignment, courierName, courierCode, serviceName,
    customerId, customerName, customerAccount,
    recipientName, recipientPost, recipientAddr,
    weightKg ? parseFloat(weightKg) : null,
    estDelivery || null, trackingUrl || null,
    status, description, location, eventAt,
  ]);

  const parcelId = parcelRes.rows[0].id;

  // Dedup: skip if last recorded status is identical (allow distinct at_depot legs >1h apart).
  const lastEvt = await query(
    `SELECT status, event_at FROM tracking_events WHERE parcel_id = $1 ORDER BY event_at DESC, id DESC LIMIT 1`,
    [parcelId]
  );
  const lastStatus  = lastEvt.rows[0]?.status;
  const lastEventAt = lastEvt.rows[0]?.event_at;
  if (lastStatus && lastStatus === status) {
    if (status === 'at_depot' && lastEventAt) {
      const gapMs = new Date(eventAt) - new Date(lastEventAt);
      if (Math.abs(gapMs) <= 60 * 60 * 1000) {
        return { ok: true, consignment, status, parcel_id: parcelId, deduped: true };
      }
    } else {
      return { ok: true, consignment, status, parcel_id: parcelId, deduped: true };
    }
  }

  await query(`
    INSERT INTO tracking_events
      (parcel_id, consignment_number, event_code, status, description, location, event_at, raw_payload)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT DO NOTHING
  `, [parcelId, consignment, eventCode, status, description, location, eventAt,
      JSON.stringify(event._raw || event)]);

  // Mirror cancellation onto the shipment record if present.
  if (status === 'cancelled') {
    await query(
      `UPDATE shipments SET cancelled = true, cancelled_at = NOW(), updated_at = NOW()
       WHERE $1 = ANY(tracking_codes) AND cancelled = false`,
      [consignment]
    );
  }

  return { ok: true, consignment, status, parcel_id: parcelId };
}
