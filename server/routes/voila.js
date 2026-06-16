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
import { recordVoilaShipment } from '../services/volumeService.js';
import { recomputeHealthAll } from '../services/healthService.js';

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
      let shipments = 0, parcels = 0, items = 0, resolved = 0;
      try {
        const list = await fetchShipmentsByDateRange(isoDay(from), isoDay(to), {
          onPage: ({ total }) => console.log(`[voila-backfill] fetched ${total} shipments`),
        });
        for (const s of list) {
          const r = await recordVoilaShipment({ json: { shipment: s } });
          if (r) { shipments++; parcels += r.parcels; items += r.items; if (r.resolved) resolved++; }
        }

        // Backfill despatch date for any shipment missing it (from stored created_at),
        // then fully rebuild the daily parcels + items totals by DESPATCH date.
        await query(`UPDATE shipments SET dispatched_at = COALESCE(
                       CASE WHEN raw_payload->>'created_at' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(raw_payload->>'created_at', 10)::date END,
                       collection_date
                     ) WHERE dispatched_at IS NULL`);
        await query(`DELETE FROM customer_volume_snapshots`);
        await query(`
          INSERT INTO customer_volume_snapshots (customer_id, snapshot_date, parcel_count, item_count)
          SELECT customer_id, dispatched_at, SUM(parcel_count)::int, SUM(item_count)::int
          FROM shipments
          WHERE cancelled = false AND customer_id IS NOT NULL AND dispatched_at IS NOT NULL
          GROUP BY customer_id, dispatched_at`);

        let health = 0;
        try { health = await recomputeHealthAll(); } catch (e) { console.warn('[voila-backfill] health:', e.message); }

        const detail = `${shipments} shipments, ${parcels} parcels, ${items} items, ${resolved} attributed, health ${health}`;
        await query(`INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('voila_backfill','ok',$1,$2)`, [shipments, detail]);
        console.log('✅ Voila backfill complete:', detail);
      } catch (err) {
        console.error('❌ voila-backfill error:', err.message);
        await query(`INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('voila_backfill','error',0,$1)`, [err.message]).catch(() => {});
      }
    });
  } catch (err) { next(err); }
});

export default router;
