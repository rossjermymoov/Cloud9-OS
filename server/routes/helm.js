/**
 * Cloud9 OS — Helm sync API
 *
 * GET  /api/helm/status          — is Helm configured? + live auth check
 * POST /api/helm/sync/customers  — pull fulfilment clients from Helm and upsert
 *                                  as Cloud9 customers (matched on helm_customer_id).
 */

import express from 'express';
import { query } from '../db/index.js';
import {
  fetchFulfilmentClients, helmConfigured, verify, fetchDispatchedOrders, rawFulfilmentClients,
  fetchPurchaseOrders, fetchPurchaseOrder,
} from '../services/helmClient.js';
import { normaliseOrder, upsertOrder } from '../services/volumeService.js';
import { recomputeHealthAll } from '../services/healthService.js';

const router = express.Router();

router.get('/status', async (_req, res) => {
  if (!helmConfigured()) return res.json({ configured: false });
  try {
    const me = await verify();
    res.json({ configured: true, authenticated: true, user: me });
  } catch (err) {
    res.json({ configured: true, authenticated: false, error: err.message });
  }
});

// GET /api/helm/raw/fulfilment-clients?limit=1 — inspect a real Helm payload.
router.get('/raw/fulfilment-clients', async (req, res, next) => {
  try {
    if (!helmConfigured()) return res.status(503).json({ error: 'Helm API not configured' });
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 1, 1), 10);
    const data = await rawFulfilmentClients(1);
    const sample = Array.isArray(data?.data) ? data.data.slice(0, limit) : data;
    res.json({ count: data?.total ?? (Array.isArray(sample) ? sample.length : 1), sample });
  } catch (err) { next(err); }
});

router.post('/sync/customers', async (_req, res, next) => {
  try {
    if (!helmConfigured()) {
      return res.status(503).json({ error: 'Helm API not configured — set HELM_API_BASE / HELM_EMAIL / HELM_PASSWORD in server/.env' });
    }

    const clients = await fetchFulfilmentClients();
    let inserted = 0, updated = 0;

    for (const c of clients) {
      if (!c.helm_customer_id) continue;
      const r = await query(`
        INSERT INTO customers
          (business_name, helm_customer_id, helm_accounts_id, primary_email, accounts_email, phone_number, account_status)
        VALUES ($1,$2,$3,$4,$5,$6,$7::account_status)
        ON CONFLICT (helm_customer_id) DO UPDATE SET
          business_name  = EXCLUDED.business_name,
          helm_accounts_id = EXCLUDED.helm_accounts_id,
          primary_email  = EXCLUDED.primary_email,
          accounts_email = EXCLUDED.accounts_email,
          phone_number   = EXCLUDED.phone_number,
          updated_at     = NOW()
        RETURNING (xmax = 0) AS was_insert
      `, [c.business_name, c.helm_customer_id, c.helm_accounts_id, c.primary_email, c.accounts_email, c.phone_number, c.account_status]);
      if (r.rows[0]?.was_insert) inserted++; else updated++;
    }

    await query(
      `INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('customers','ok',$1,$2)`,
      [clients.length, `${inserted} inserted, ${updated} updated`]
    );
    res.json({ ok: true, total: clients.length, inserted, updated });
  } catch (err) {
    await query(
      `INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('customers','error',0,$1)`,
      [err.message]
    ).catch(() => {});
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/helm/sync/volume?days=30
// Pull despatched orders per customer and upsert daily parcels + items into
// customer_volume_snapshots. Run customer sync first so customers carry
// helm_customer_id (= Helm fulfilment_client id).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sync/volume', async (req, res, next) => {
  try {
    if (!helmConfigured()) {
      return res.status(503).json({ error: 'Helm API not configured — set HELM_API_BASE / HELM_EMAIL / HELM_PASSWORD in server/.env' });
    }

    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
    const to   = new Date();
    const from = new Date(Date.now() - (days - 1) * 86400000);

    const { rows: customers } = await query(
      `SELECT id, helm_customer_id FROM customers WHERE helm_customer_id IS NOT NULL`
    );
    if (!customers.length) {
      return res.status(409).json({ error: 'No customers with a Helm id — run POST /api/helm/sync/customers first.' });
    }

    let customersProcessed = 0, ordersWritten = 0;

    // Backfill: upsert each despatched order into the orders table. Parcel counts
    // come from the order's shipment data where present; webhooks (order-created /
    // order-updated) are the authoritative source and will correct any estimates.
    // parcelFloor:1 ensures a despatched order counts as at least one parcel when
    // the pull response carries no parcel detail.
    for (const c of customers) {
      const orders = await fetchDispatchedOrders({ helmClientId: c.helm_customer_id, from, to });
      for (const raw of orders) {
        const n = normaliseOrder(raw, { helmClientId: c.helm_customer_id, parcelFloor: 1 });
        await upsertOrder(n);
        ordersWritten++;
      }
      customersProcessed++;
    }

    // Recompute health scores now that volume is up to date.
    let healthUpdated = 0;
    try { healthUpdated = await recomputeHealthAll(); } catch (e) { console.warn('[health] recompute failed:', e.message); }

    await query(
      `INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('volume','ok',$1,$2)`,
      [ordersWritten, `${customersProcessed} customers, ${ordersWritten} orders over ${days}d`]
    );
    res.json({ ok: true, days, customers: customersProcessed, orders: ordersWritten, health_updated: healthUpdated });
  } catch (err) {
    await query(
      `INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('volume','error',0,$1)`,
      [err.message]
    ).catch(() => {});
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/helm/backfill?days=30
// Month (or N-day) backfill of dispatch volume for EVERY customer. Runs in the
// background and returns 202 immediately so a large pull never times out.
// Pulls despatched orders per fulfilment client → orders table → volume snapshots
// → recomputes health. Watch progress at GET /api/helm/sync-log.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/backfill', async (req, res, next) => {
  try {
    if (!helmConfigured()) {
      return res.status(503).json({ error: 'Helm API not configured' });
    }
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);

    res.status(202).json({
      status: 'started', days,
      message: `Backfilling ${days} days for every customer in the background. Check GET /api/helm/sync-log for the result.`,
    });

    setImmediate(async () => {
      const to   = new Date();
      const from = new Date(Date.now() - (days - 1) * 86400000);
      let customersDone = 0, ordersWritten = 0, failed = 0;
      try {
        const { rows: customers } = await query(
          `SELECT id, helm_customer_id, business_name FROM customers WHERE helm_customer_id IS NOT NULL`
        );
        console.log(`🔄 Backfill: ${customers.length} customers, ${days} days`);
        for (const c of customers) {
          try {
            const list = await fetchDispatchedOrders({ helmClientId: c.helm_customer_id, from, to });
            for (const raw of list) {
              await upsertOrder(normaliseOrder(raw, { helmClientId: c.helm_customer_id, parcelFloor: 1 }));
              ordersWritten++;
            }
          } catch (e) {
            failed++;
            console.warn(`[backfill] ${c.business_name}: ${e.message}`);
          }
          customersDone++;
        }
        let health = 0;
        try { health = await recomputeHealthAll(); } catch (e) { console.warn('[backfill] health:', e.message); }

        const detail = `${customersDone} customers, ${ordersWritten} orders over ${days}d, ${failed} failed, health ${health}`;
        await query(`INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('backfill','ok',$1,$2)`, [ordersWritten, detail]);
        console.log(`✅ Backfill complete: ${detail}`);
      } catch (err) {
        console.error('❌ backfill error:', err.message);
        await query(`INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('backfill','error',0,$1)`, [err.message]).catch(() => {});
      }
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/helm/sync/purchase-orders
// Pull all purchase orders from Helm (list → detail) and upsert them with their
// SKU lines, expected delivery date and status. Runs in the background.
// ─────────────────────────────────────────────────────────────────────────────
const PO_STATUS = { 11: 'open', 12: 'open', 13: 'open', 14: 'partially_received', 15: 'received', 16: 'cancelled', 25: 'received' };

// Reusable PO sync — used by the route and the 30-minute scheduler.
export async function syncPurchaseOrders() {
  let total = 0, upserted = 0, failed = 0;
  try {
    const list = await fetchPurchaseOrders();
    total = list.length;
    console.log(`🔄 PO sync: ${total} purchase orders`);
    for (const head of list) {
      try {
        const po = await fetchPurchaseOrder(head.id);
        const lines = Array.isArray(po.inventory) ? po.inventory : [];
        const totalUnits = lines.reduce((a, l) => a + (parseInt(l.quantity) || 0), 0);
        const status = PO_STATUS[po.status_id] || 'open';

        let customerId = null, customerName = null;
        if (po.fulfilment_client_id != null) {
          const r = await query(`SELECT id, business_name FROM customers WHERE helm_customer_id = $1`, [String(po.fulfilment_client_id)]);
          if (r.rows.length) { customerId = r.rows[0].id; customerName = r.rows[0].business_name; }
        }
        if (!customerName) customerName = po.shipping_name_company || po.supplier_name_company || null;

        const ins = await query(`
          INSERT INTO purchase_orders
            (helm_po_id, po_number, customer_id, customer_name, status, helm_status_id, expected_date, total_lines, total_units, raw_payload)
          VALUES ($1,$2,$3,$4,$5::po_status,$6,$7,$8,$9,$10)
          ON CONFLICT (helm_po_id) DO UPDATE SET
            po_number      = EXCLUDED.po_number,
            customer_id    = COALESCE(EXCLUDED.customer_id, purchase_orders.customer_id),
            customer_name  = COALESCE(EXCLUDED.customer_name, purchase_orders.customer_name),
            status         = EXCLUDED.status,
            helm_status_id = EXCLUDED.helm_status_id,
            expected_date  = EXCLUDED.expected_date,
            total_lines    = EXCLUDED.total_lines,
            total_units    = EXCLUDED.total_units,
            raw_payload    = EXCLUDED.raw_payload,
            updated_at     = NOW()
          RETURNING id
        `, [
          String(po.id), (po.purchase_order_id || '').slice(0, 80) || null, customerId, customerName,
          status, po.status_id != null ? parseInt(po.status_id) : null, po.expected_delivery_date || null,
          lines.length, totalUnits, JSON.stringify(po).slice(0, 200000),
        ]);
        const poId = ins.rows[0].id;
        await query(`DELETE FROM purchase_order_lines WHERE po_id = $1`, [poId]);
        for (const l of lines) {
          await query(
            `INSERT INTO purchase_order_lines (po_id, sku, description, qty_ordered, qty_received) VALUES ($1,$2,$3,$4,$5)`,
            [poId, l.sku || null, l.name || null, parseInt(l.quantity) || 0, parseInt(l.delivered_quantity) || 0]
          );
        }
        upserted++;
      } catch (e) { failed++; console.warn(`[po-sync] ${head.id}: ${e.message}`); }
    }
    await query(`INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('purchase_orders','ok',$1,$2)`,
      [upserted, `${upserted} POs upserted, ${failed} failed of ${total}`]);
    console.log(`✅ PO sync complete: ${upserted}/${total} upserted, ${failed} failed`);
  } catch (err) {
    console.error('❌ po-sync error:', err.message);
    await query(`INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('purchase_orders','error',0,$1)`, [err.message]).catch(() => {});
  }
  return { total, upserted, failed };
}

router.post('/sync/purchase-orders', async (_req, res, next) => {
  try {
    if (!helmConfigured()) return res.status(503).json({ error: 'Helm API not configured' });
    res.status(202).json({ status: 'started', message: 'Pulling purchase orders in the background. Check GET /api/helm/sync-log.' });
    setImmediate(() => syncPurchaseOrders());
  } catch (err) { next(err); }
});

// GET /api/helm/sync-log?limit=10 — recent sync / backfill runs.
router.get('/sync-log', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT sync_type, status, records, detail, ran_at FROM helm_sync_log ORDER BY ran_at DESC LIMIT $1`,
      [Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50)]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
