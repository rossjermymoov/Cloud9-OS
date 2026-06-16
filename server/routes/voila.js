/**
 * Cloud9 OS — Voila API (shipment backfill)
 *
 * GET  /api/voila/status          — is the Voila API configured?
 * POST /api/voila/backfill?days=30 — pull a month of shipments and total
 *                                    parcels + items per customer per day.
 *                                    Runs in the background; watch /api/helm/sync-log.
 */

import express from 'express';
import { query } from '../db/index.js';
import { fetchShipmentsByDateRange, voilaConfigured } from '../services/voilaClient.js';
import { countShipmentParcels, countShipmentItems } from '../services/volumeService.js';
import { recomputeHealthAll } from '../services/healthService.js';

function parseRS(v) { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } }

const router = express.Router();

router.get('/status', (_req, res) => res.json({ configured: voilaConfigured() }));

// GET /api/voila/probe?days=3 — see how many shipments the API returns + a sample shape.
router.get('/probe', async (req, res, next) => {
  try {
    if (!voilaConfigured()) return res.status(503).json({ error: 'Voila API not configured' });
    const days = Math.min(Math.max(parseInt(req.query.days) || 3, 1), 31);
    const to = new Date(), from = new Date(Date.now() - (days - 1) * 86400000);
    const p = (n) => String(n).padStart(2, '0');
    const iso = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T00:00:00`;
    const list = await fetchShipmentsByDateRange(iso(from), iso(to));
    const s = list[0] || null;
    const parseRS = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
    const rs = s ? parseRS(s.request_shipment) : null;
    res.json({
      base: process.env.VOILA_API_BASE || 'https://app.heyvoila.io/api',
      range: { from: iso(from), to: iso(to) },
      count: list.length,
      sample_keys: s ? Object.keys(s) : [],
      sample: s ? {
        id: s.id, created_at: s.created_at, date_created: s.date_created, collection_date: s.collection_date,
        account_name: s.account_name, account_number: s.account_number,
        create_label_parcels_len: Array.isArray(s.create_label_parcels) ? s.create_label_parcels.length : null,
        rs_accounts_id: rs?.accounts_id, rs_collection_date: rs?.collection_date,
        rs_parcels_len: Array.isArray(rs?.parcels) ? rs.parcels.length : null,
      } : null,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function isoDay(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T00:00:00`;
}

router.post('/backfill', async (req, res, next) => {
  try {
    if (!voilaConfigured()) {
      return res.status(503).json({ error: 'Voila API not configured — set VOILA_API_USER / VOILA_API_TOKEN in server/.env' });
    }
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
    const to   = new Date();
    const from = new Date(Date.now() - (days - 1) * 86400000);

    res.status(202).json({
      status: 'started', days,
      message: `Backfilling ${days} days of Voila shipments in the background. Check GET /api/helm/sync-log.`,
    });

    setImmediate(async () => {
      let stored = 0, parcels = 0, items = 0, attributed = 0;
      try {
        // 1. Customer lookup map (accounts_id → customer id), loaded once.
        const cm = await query(`SELECT helm_accounts_id, id FROM customers WHERE helm_accounts_id IS NOT NULL`);
        const custByAcct = new Map(cm.rows.map(r => [String(r.helm_accounts_id).trim().toLowerCase(), r.id]));

        // 2. Fetch all shipments in the window.
        const list = await fetchShipmentsByDateRange(isoDay(from), isoDay(to), {
          onPage: ({ total }) => console.log(`[voila-backfill] fetched ${total} shipments`),
        });
        console.log(`[voila-backfill] fetched ${list.length} shipments total — storing…`);

        // 3. Build rows in memory (parcels, items, customer, despatch date).
        const rows = list.map(s => {
          const rs = parseRS(s.request_shipment);
          const accountsId = (rs && rs.accounts_id) || s.account_name || s.account_number || null;
          const customerId = accountsId ? (custByAcct.get(String(accountsId).trim().toLowerCase()) || null) : null;
          const p = countShipmentParcels(s, rs);
          const it = countShipmentItems(rs);
          const despatched = s.created_at || s.collection_date || (rs && rs.collection_date) || null;
          const day = despatched ? String(despatched).slice(0, 10) : null;
          if (customerId) attributed++;
          parcels += p; items += it;
          return {
            id: String(s.id), customerId, accountsId, courier: s.courier || null, reference: s.reference || null,
            shipTo: s.ship_to_name || null, postcode: s.ship_to_postcode || null,
            parcels: p, items: it, collection: s.collection_date ? String(s.collection_date).slice(0, 10) : null,
            day, cancelled: !!s.cancelled,
          };
        });

        // 4. Batch upsert shipments (chunks of 500) — far fewer round-trips.
        const CH = 500;
        for (let i = 0; i < rows.length; i += CH) {
          const chunk = rows.slice(i, i + CH);
          const ph = [], vals = [];
          chunk.forEach((r, j) => {
            const b = j * 12;
            ph.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12})`);
            vals.push(r.id, r.customerId, r.accountsId, r.courier, r.reference, r.shipTo, r.postcode, r.parcels, r.items, r.collection, r.day, r.cancelled);
          });
          await query(`
            INSERT INTO shipments
              (helm_shipment_id, customer_id, customer_account, courier, reference, ship_to_name, ship_to_postcode,
               parcel_count, item_count, collection_date, dispatched_at, cancelled)
            VALUES ${ph.join(',')}
            ON CONFLICT (helm_shipment_id) DO UPDATE SET
              customer_id      = COALESCE(EXCLUDED.customer_id, shipments.customer_id),
              customer_account = COALESCE(EXCLUDED.customer_account, shipments.customer_account),
              courier          = COALESCE(EXCLUDED.courier, shipments.courier),
              parcel_count     = EXCLUDED.parcel_count,
              item_count       = EXCLUDED.item_count,
              collection_date  = COALESCE(EXCLUDED.collection_date, shipments.collection_date),
              dispatched_at    = COALESCE(EXCLUDED.dispatched_at, shipments.dispatched_at),
              cancelled        = EXCLUDED.cancelled,
              updated_at       = NOW()
          `, vals);
          stored += chunk.length;
        }

        // 5. Rebuild the daily totals once, by despatch date.
        await query(`UPDATE shipments SET dispatched_at = collection_date WHERE dispatched_at IS NULL AND collection_date IS NOT NULL`);
        await query(`DELETE FROM customer_volume_snapshots`);
        await query(`
          INSERT INTO customer_volume_snapshots (customer_id, snapshot_date, parcel_count, item_count)
          SELECT customer_id, dispatched_at, SUM(parcel_count)::int, SUM(item_count)::int
          FROM shipments
          WHERE cancelled = false AND customer_id IS NOT NULL AND dispatched_at IS NOT NULL
          GROUP BY customer_id, dispatched_at`);

        let health = 0;
        try { health = await recomputeHealthAll(); } catch (e) { console.warn('[voila-backfill] health:', e.message); }

        const detail = `${stored} shipments, ${parcels} parcels, ${items} items, ${attributed} attributed, health ${health}`;
        await query(`INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('voila_backfill','ok',$1,$2)`, [stored, detail]);
        console.log('✅ Voila backfill complete:', detail);
      } catch (err) {
        console.error('❌ voila-backfill error:', err.message);
        await query(`INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('voila_backfill','error',0,$1)`, [err.message]).catch(() => {});
      }
    });
  } catch (err) { next(err); }
});

export default router;
