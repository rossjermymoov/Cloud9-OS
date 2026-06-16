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
