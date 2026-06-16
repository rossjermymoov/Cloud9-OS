/**
 * Cloud9 OS — Inbound webhooks (the pipework)
 *
 * All endpoints share one bearer token (CLOUD9_WEBHOOK_TOKEN) and follow the
 * Moov OS pattern: respond 200 immediately, process in the background, so the
 * sender never retries and never times out.
 *
 *   POST /api/v1/webhooks/purchase-order-created   → PO + notification
 *   POST /api/v1/webhooks/inbound-received         → mark PO lines received
 *   POST /api/v1/webhooks/shipment-created         → shipment record + counts
 *   POST /api/v1/webhooks/shipment-cancelled       → mark shipment cancelled
 *   POST /api/v1/webhooks/tracking-update          → tracking ingest
 *
 * Payload shapes below are our proposed contract — they will be finalised
 * against the real Helm webhook payloads.
 */

import express from 'express';
import { query } from '../db/index.js';
import { normalisePayload, upsertEvent } from '../services/statusEngine.js';
import { createNotification, resolveCustomer } from '../services/notificationService.js';
import { normaliseOrder, upsertOrder } from '../services/volumeService.js';
import { mapFulfilmentClient } from '../services/helmClient.js';

const router = express.Router();

const WEBHOOK_TOKEN = process.env.CLOUD9_WEBHOOK_TOKEN || 'change-me';

// Pull the token from wherever the sender put it: Authorization (with or without
// a "Bearer " prefix), a common custom header, or a ?token= query param.
function extractToken(req) {
  // Custom header names first (Voila sends `cloud9_webhook_token`).
  const h = req.headers['cloud9_webhook_token']
         || req.headers['cloud9-webhook-token']
         || req.headers['x-cloud9-token']
         || req.headers['x-webhook-token']
         || req.headers['x-api-key']
         || req.headers['token']
         || '';
  if (h) return String(h).trim();
  const auth = (req.headers['authorization'] || '').trim();
  if (auth) return (auth.startsWith('Bearer ') ? auth.slice(7) : auth).trim();
  // Voila nests the token in the JSON body under headers.CLOUD9_WEBHOOK_TOKEN.
  const bh = req.body && typeof req.body === 'object' ? (req.body.headers || {}) : {};
  const bodyTok = bh.CLOUD9_WEBHOOK_TOKEN || bh.cloud9_webhook_token || bh.Authorization || bh.authorization;
  if (bodyTok) return String(bodyTok).replace(/^Bearer\s+/i, '').trim();
  if (req.query.token) return String(req.query.token).trim();
  return '';
}

function authMiddleware(req, res, next) {
  if (extractToken(req) !== WEBHOOK_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── Capture every inbound webhook's raw body ────────────────────────────────
// Lets us inspect real Helm payloads (parcel structure, fulfilment client id)
// to lock the parsers. Fire-and-forget; never blocks the handler.
router.use((req, res, next) => {
  if (req.method === 'POST') {
    const endpoint = req.path.replace(/^\//, '');
    query(
      `INSERT INTO webhook_log (endpoint, authorized, payload) VALUES ($1,$2,$3)`,
      [endpoint.slice(0, 80), extractToken(req) === WEBHOOK_TOKEN, JSON.stringify(req.body ?? null)]
    ).catch(() => { /* logging must never break the webhook */ });
  }
  next();
});

// GET /api/v1/webhooks/auth-check — diagnose a 401 without exposing the secret.
// Call it WITH the same auth header/token you put in Helm; it tells you whether
// the server has a token configured and whether yours matches.
router.get('/auth-check', (req, res) => {
  const mask = (s) => (s ? `${s.slice(0, 2)}…${s.slice(-2)} (len ${s.length})` : '(none)');
  const recv = extractToken(req);
  res.json({
    token_configured: WEBHOOK_TOKEN !== 'change-me',
    expected: mask(WEBHOOK_TOKEN),
    received: mask(recv),
    matches: recv === WEBHOOK_TOKEN,
  });
});

// GET /api/v1/webhooks/log?endpoint=order-created&limit=20 — inspect captures
router.get('/log', async (req, res, next) => {
  try {
    const { endpoint, limit = 20 } = req.query;
    const vals = [];
    let where = '';
    if (endpoint) { where = 'WHERE endpoint = $1'; vals.push(endpoint); }
    const { rows } = await query(
      `SELECT id, endpoint, authorized, payload, received_at
       FROM webhook_log ${where}
       ORDER BY received_at DESC LIMIT ${parseInt(limit) || 20}`,
      vals
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /order-created  and  POST /order-updated  — outbound orders
//
// Both upsert into the `orders` table (source of truth for dispatch volume) and,
// when the order is despatched, refresh that customer's daily volume snapshot
// using the REAL per-order parcel count. An order may have many parcels.
//
// Proposed body: { order: { id, channel_order_id, fulfilment_client_id,
//   status_id, status, sale_type, total_inventory_quantity, total_weight,
//   date_received, date_dispatched,
//   shipment: [{ parcels: [{ tracking_code }] }]   // or parcel_count / parcels[] / tracking_codes[]
// } }
// ─────────────────────────────────────────────────────────────────────────────
function handleOrderWebhook(eventName, { forceDispatched = false } = {}) {
  return (req, res) => {
    const body = req.body;
    res.json({ status: 'accepted' });
    setImmediate(async () => {
      try {
        if (!body) return;
        const n = normaliseOrder(body, { parcelFloor: 1, forceDispatched });
        if (!n.helm_order_id) { console.warn(`[${eventName}] no order id in payload`); return; }
        const { customerId, day } = await upsertOrder(n);
        console.log(`✅ ${eventName}: order ${n.helm_order_id} — ${n.parcel_count} parcel(s), ${n.item_count} item(s)${day ? `, dispatched ${day}` : ''}${customerId ? '' : ' (customer unresolved)'}`);
      } catch (err) {
        console.error(`❌ ${eventName} error:`, err.message);
      }
    });
  };
}
router.post('/order-created',   authMiddleware, handleOrderWebhook('order-created'));
router.post('/order-updated',   authMiddleware, handleOrderWebhook('order-updated'));
router.post('/order-dispatched', authMiddleware, handleOrderWebhook('order-dispatched', { forceDispatched: true }));

// ─────────────────────────────────────────────────────────────────────────────
// POST /fulfilment-client-created  — a new client is onboarding in Helm
// Upserts the Cloud9 customer and raises an onboarding notification.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/fulfilment-client-created', authMiddleware, (req, res) => {
  const fc = req.body?.fulfilment_client || req.body?.client || req.body;
  res.json({ status: 'accepted' });
  setImmediate(async () => {
    try {
      if (!fc || fc.id == null) { console.warn('[fulfilment-client-created] no client id'); return; }
      const c = mapFulfilmentClient(fc);
      const ins = await query(`
        INSERT INTO customers
          (business_name, helm_customer_id, helm_accounts_id, primary_email, accounts_email, phone_number, account_status)
        VALUES ($1,$2,$3,$4,$5,$6,$7::account_status)
        ON CONFLICT (helm_customer_id) DO UPDATE SET
          business_name = EXCLUDED.business_name, primary_email = EXCLUDED.primary_email,
          accounts_email = EXCLUDED.accounts_email, phone_number = EXCLUDED.phone_number, updated_at = NOW()
        RETURNING id
      `, [c.business_name, c.helm_customer_id, c.helm_accounts_id, c.primary_email, c.accounts_email, c.phone_number, c.account_status]);

      const customerId = ins.rows[0]?.id;
      await createNotification({
        type: 'new_client', severity: 'amber',
        customer_id: customerId, customer_name: c.business_name,
        title: `New client onboarding: ${c.business_name}`,
        body: 'A new fulfilment client was created in Helm.',
        link_url: customerId ? `/customers/${customerId}` : '/customers',
        source_event: 'fulfilment-client-created',
      });
      console.log(`✅ fulfilment-client-created: ${c.business_name}`);
    } catch (err) {
      console.error('❌ fulfilment-client-created error:', err.message);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /return-created  — a return has been raised (important!)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/return-created', authMiddleware, (req, res) => {
  const r = req.body?.return || req.body;
  res.json({ status: 'accepted' });
  setImmediate(async () => {
    try {
      const customer = await resolveCustomer(r?.fulfilment_client_id ?? r?.client_id ?? r?.account_number);
      const ref     = r?.reference || r?.return_reference || null;
      const orderRef = r?.order_id || r?.order_reference || r?.channel_order_id || null;
      await query(`
        INSERT INTO returns
          (helm_return_id, customer_id, helm_client_id, reference, order_ref, status, reason, item_count, raw_payload)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (helm_return_id) DO UPDATE SET
          status = EXCLUDED.status, reason = EXCLUDED.reason, updated_at = NOW()
      `, [
        r?.id != null ? String(r.id) : null,
        customer?.id || null,
        r?.fulfilment_client_id != null ? String(r.fulfilment_client_id) : null,
        ref, orderRef, r?.status || null, r?.reason || null,
        parseInt(r?.item_count ?? r?.total_quantity) || 0,
        JSON.stringify(r || {}),
      ]);

      await createNotification({
        type: 'return_created', severity: 'amber',
        customer_id: customer?.id || null,
        customer_name: customer?.business_name || null,
        title: `Return created${customer ? ` · ${customer.business_name}` : ''}`,
        body: ref || orderRef ? `Ref ${ref || orderRef}` : 'A return was raised in Helm.',
        link_url: customer?.id ? `/customers/${customer.id}` : '/returns',
        source_event: 'return-created',
      });
      console.log('✅ return-created processed');
    } catch (err) {
      console.error('❌ return-created error:', err.message);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Capture-only endpoints — return 200 and rely on the webhook_log to record the
// real payload shape; full handlers added once we've seen a live sample.
//   inventory-created (we don't track inventory detail), pick-completed.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/inventory-created', authMiddleware, (_req, res) => res.json({ status: 'accepted' }));

// POST /pick-completed — record a completed pick (throughput metric).
router.post('/pick-completed', authMiddleware, (req, res) => {
  const p = req.body?.pick || req.body;
  res.json({ status: 'accepted' });
  setImmediate(async () => {
    try {
      const customer = await resolveCustomer(p?.fulfilment_client_id ?? p?.client_id);
      const pickedAt = p?.completed_at || p?.picked_at || p?.updated_at || new Date().toISOString();
      await query(`
        INSERT INTO pick_events (helm_pick_id, customer_id, helm_client_id, item_count, picked_at, raw_payload)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (helm_pick_id) DO NOTHING
      `, [
        p?.id != null ? String(p.id) : null,
        customer?.id || null,
        p?.fulfilment_client_id != null ? String(p.fulfilment_client_id) : null,
        parseInt(p?.item_count ?? p?.total_quantity ?? p?.picked_quantity) || 0,
        pickedAt,
        JSON.stringify(p || {}),
      ]);
      console.log('✅ pick-completed recorded');
    } catch (err) {
      console.error('❌ pick-completed error:', err.message);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /purchase-order-created  — customer books stock into the warehouse
// Proposed body: { po: { id, po_number, account_number, customer_name,
//                        expected_date, lines: [{ sku, description, qty }] } }
// ─────────────────────────────────────────────────────────────────────────────
const PO_STATUSES = { open: 'open', partially_received: 'partially_received', received: 'received', cancelled: 'cancelled' };

async function processPurchaseOrder(po, { eventName }) {
  if (!po) return;
  const created    = eventName === 'purchase-order-created';
  const customer   = await resolveCustomer(po.account_number || po.customer_account || po.customer_id || po.fulfilment_client_id);
  const lines      = Array.isArray(po.lines) ? po.lines : [];
  const totalUnits = lines.reduce((s, l) => s + (parseInt(l.qty ?? l.qty_ordered) || 0), 0);
  const status     = PO_STATUSES[String(po.status || '').toLowerCase()] || 'open';

  const poRes = await query(`
    INSERT INTO purchase_orders
      (helm_po_id, po_number, customer_id, customer_account, customer_name,
       status, expected_date, total_lines, total_units, raw_payload)
    VALUES ($1,$2,$3,$4,$5,$6::po_status,$7,$8,$9,$10)
    ON CONFLICT (helm_po_id) DO UPDATE SET
      po_number     = COALESCE(EXCLUDED.po_number, purchase_orders.po_number),
      customer_id   = COALESCE(EXCLUDED.customer_id, purchase_orders.customer_id),
      customer_name = COALESCE(EXCLUDED.customer_name, purchase_orders.customer_name),
      status        = EXCLUDED.status,
      expected_date = COALESCE(EXCLUDED.expected_date, purchase_orders.expected_date),
      total_lines   = EXCLUDED.total_lines, total_units = EXCLUDED.total_units,
      raw_payload   = EXCLUDED.raw_payload, updated_at = NOW()
    RETURNING id
  `, [
    po.id != null ? String(po.id) : null,
    po.po_number || null,
    customer?.id || null,
    po.account_number || po.customer_account || null,
    po.customer_name || customer?.business_name || null,
    status,
    po.expected_date || null,
    lines.length,
    totalUnits,
    JSON.stringify(po),
  ]);
  const poId = poRes.rows[0]?.id;

  if (lines.length) {
    await query('DELETE FROM purchase_order_lines WHERE po_id = $1', [poId]);
    for (const l of lines) {
      await query(
        `INSERT INTO purchase_order_lines (po_id, sku, description, qty_ordered, qty_received)
         VALUES ($1,$2,$3,$4,$5)`,
        [poId, l.sku || null, l.description || null, parseInt(l.qty ?? l.qty_ordered) || 0, parseInt(l.qty_received) || 0]
      );
    }
  }

  const name = po.customer_name || customer?.business_name || 'A customer';
  await createNotification({
    type:         created ? 'purchase_order_created' : 'purchase_order_updated',
    severity:     status === 'received' ? 'green' : 'amber',
    customer_id:  customer?.id || null,
    customer_name: name,
    title:        created ? `${name} raised a purchase order` : `Purchase order updated · ${name}`,
    body:         `${po.po_number ? `PO ${po.po_number} — ` : ''}${lines.length} line(s), ${totalUnits} unit(s)${created ? ' booked in.' : ` · ${status.replace('_', ' ')}`}`,
    link_url:     customer?.id ? `/customers/${customer.id}` : `/notifications`,
    source_event: eventName,
  });
  console.log(`✅ ${eventName}: ${po.po_number || poId} (${status})`);
}

router.post('/purchase-order-created', authMiddleware, (req, res) => {
  res.json({ status: 'accepted' });
  setImmediate(() => processPurchaseOrder(req.body?.po || req.body, { eventName: 'purchase-order-created' })
    .catch(e => console.error('❌ purchase-order-created error:', e.message)));
});
router.post('/purchase-order-updated', authMiddleware, (req, res) => {
  res.json({ status: 'accepted' });
  setImmediate(() => processPurchaseOrder(req.body?.po || req.body, { eventName: 'purchase-order-updated' })
    .catch(e => console.error('❌ purchase-order-updated error:', e.message)));
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /delivery-created  — a delivery has been created (goods-in / dispatch leg)
// Notifies + captured to webhook_log; exact mapping confirmed against a real fire.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/delivery-created', authMiddleware, (req, res) => {
  const d = req.body?.delivery || req.body;
  res.json({ status: 'accepted' });
  setImmediate(async () => {
    try {
      const customer = await resolveCustomer(d?.fulfilment_client_id ?? d?.client_id ?? d?.account_number);
      await createNotification({
        type: 'delivery_created', severity: 'green',
        customer_id: customer?.id || null, customer_name: customer?.business_name || null,
        title: `Delivery created${customer ? ` · ${customer.business_name}` : ''}`,
        body: (d?.delivery_reference || d?.reference) ? `Ref ${d.delivery_reference || d.reference}` : 'A delivery was created in Helm.',
        link_url: customer?.id ? `/customers/${customer.id}` : '/notifications',
        source_event: 'delivery-created', payload: d,
      });
      console.log('✅ delivery-created processed');
    } catch (err) {
      console.error('❌ delivery-created error:', err.message);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /inbound-received  — stock booked in against a PO
// Proposed body: { po_id, lines: [{ sku, qty_received }] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/inbound-received', authMiddleware, (req, res) => {
  const data = req.body;
  res.json({ status: 'accepted' });

  setImmediate(async () => {
    try {
      const helmPoId = data.po_id != null ? String(data.po_id) : null;
      if (!helmPoId) return;
      const poRes = await query(`SELECT id, customer_id, customer_name, po_number FROM purchase_orders WHERE helm_po_id = $1`, [helmPoId]);
      const po = poRes.rows[0];
      if (!po) { console.warn(`[inbound-received] no PO for helm_po_id=${helmPoId}`); return; }

      for (const l of (data.lines || [])) {
        await query(
          `UPDATE purchase_order_lines SET qty_received = qty_received + $1
           WHERE po_id = $2 AND sku = $3`,
          [parseInt(l.qty_received) || 0, po.id, l.sku || null]
        );
      }

      // Recompute PO status from line fulfilment.
      const sums = await query(
        `SELECT COALESCE(SUM(qty_ordered),0) AS ordered, COALESCE(SUM(qty_received),0) AS received
         FROM purchase_order_lines WHERE po_id = $1`, [po.id]
      );
      const { ordered, received } = sums.rows[0];
      const status = received <= 0 ? 'open' : (received >= ordered ? 'received' : 'partially_received');
      await query(`UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE id = $2`, [status, po.id]);

      await createNotification({
        type:         'stock_received',
        severity:     status === 'received' ? 'green' : 'amber',
        customer_id:  po.customer_id,
        customer_name: po.customer_name,
        title:        `Stock received for ${po.customer_name || 'customer'}`,
        body:         `${po.po_number ? `PO ${po.po_number}: ` : ''}${received}/${ordered} units booked in (${status.replace('_',' ')}).`,
        link_url:     po.customer_id ? `/customers/${po.customer_id}` : `/notifications`,
        source_event: 'inbound-received',
      });

      console.log(`✅ Inbound received: ${po.po_number || po.id} now ${status}`);
    } catch (err) {
      console.error('❌ inbound-received error:', err.message);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /shipment-created  — outbound shipment / label created
// Proposed body: { shipment: { id, account_number, courier, reference,
//                              ship_to_name, ship_to_postcode, parcel_count,
//                              tracking_codes: [] } }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/shipment-created', authMiddleware, (req, res) => {
  const ship = req.body?.shipment || req.body;
  res.json({ status: 'accepted' });

  setImmediate(async () => {
    try {
      if (!ship) return;
      const customer = await resolveCustomer(ship.account_number || ship.customer_account);
      const tracking = Array.isArray(ship.tracking_codes) ? ship.tracking_codes.filter(Boolean) : [];

      await query(`
        INSERT INTO shipments
          (helm_shipment_id, customer_id, customer_account, courier, reference, reference_2,
           ship_to_name, ship_to_postcode, ship_to_country_iso, parcel_count, total_weight_kg,
           collection_date, tracking_codes, raw_payload)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (helm_shipment_id) DO UPDATE SET
          tracking_codes = COALESCE(EXCLUDED.tracking_codes, shipments.tracking_codes),
          updated_at = NOW()
      `, [
        ship.id != null ? String(ship.id) : null,
        customer?.id || null,
        ship.account_number || null,
        ship.courier || null,
        ship.reference || null,
        ship.reference_2 || null,
        ship.ship_to_name || null,
        ship.ship_to_postcode || null,
        ship.ship_to_country_iso || null,
        ship.parcel_count || 1,
        ship.total_weight_kg || null,
        ship.collection_date ? String(ship.collection_date).split('T')[0] : null,
        tracking.length ? tracking : null,
        JSON.stringify(ship),
      ]);

      console.log(`✅ Shipment created: ${ship.reference || ship.id}`);
    } catch (err) {
      console.error('❌ shipment-created error:', err.message);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /shipment-cancelled
// ─────────────────────────────────────────────────────────────────────────────
router.post('/shipment-cancelled', authMiddleware, async (req, res, next) => {
  try {
    const ship = req.body?.shipment || req.body;
    const id   = ship?.id != null ? String(ship.id) : null;
    const ref  = ship?.reference || null;
    if (!id && !ref) return res.status(400).json({ error: 'shipment id or reference required' });

    const result = await query(
      `UPDATE shipments SET cancelled = true, cancelled_at = NOW(), updated_at = NOW()
       WHERE (helm_shipment_id = $1 OR reference = $2) AND cancelled = false
       RETURNING id`,
      [id, ref]
    );
    res.json({ status: 'ok', cancelled: result.rows.length });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /tracking-update  — carrier scan / status change (same engine as page)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/tracking-update', authMiddleware, (req, res) => {
  const body = req.body;
  res.json({ status: 'accepted' });

  setImmediate(async () => {
    try {
      const events = normalisePayload(body);
      for (const event of events) {
        const r = await upsertEvent(event);
        // Raise a notification on exception-type statuses.
        if (r.ok && ['failed_delivery', 'exception', 'returned', 'customs_hold', 'damaged'].includes(r.status)) {
          const p = await query(
            `SELECT customer_id, customer_name, consignment_number, status_description FROM parcels WHERE id = $1`,
            [r.parcel_id]
          );
          const row = p.rows[0];
          if (row) {
            await createNotification({
              type:         'tracking_exception',
              severity:     'red',
              customer_id:  row.customer_id,
              customer_name: row.customer_name,
              title:        `Tracking issue: ${r.status.replace('_', ' ')}`,
              body:         `${row.consignment_number} — ${row.status_description || r.status}`,
              link_url:     `/tracking?search=${encodeURIComponent(row.consignment_number)}`,
              source_event: 'tracking-update',
            });
          }
        }
      }
      console.log(`✅ tracking-update: ${events.length} event(s) processed`);
    } catch (err) {
      console.error('❌ tracking-update error:', err.message);
    }
  });
});

export default router;
