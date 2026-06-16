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
import { fetchShipmentsByDateRange, fetchShipmentsPage, voilaConfigured } from '../services/voilaClient.js';
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Streaming backfill — fetches one page at a time and inserts it, so it never
// holds the whole dataset in memory (which was killing the process). Survives
// per-page errors. `pageDelayMs` lets the nightly run go gently/slowly.
export async function runVoilaBackfill(days = 90, { pageDelayMs = 0 } = {}) {
  const to = new Date(), from = new Date(Date.now() - (days - 1) * 86400000);
  let stored = 0, parcels = 0, items = 0, attributed = 0, page = 1, lastFirstId = null, pageErrors = 0;
  // Log a 'running' row immediately so the job is always visible in the sync-log,
  // even if the process is killed mid-run. Updated to ok/error at the end.
  let logId = null;
  try {
    const lr = await query(
      `INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('voila_backfill','running',0,$1) RETURNING id`,
      [`started ${days}d backfill at ${new Date().toISOString()}`]
    );
    logId = lr.rows[0]?.id || null;
  } catch (e) { console.warn('[voila-backfill] start row failed:', e.message); }
  try {
    const cm = await query(`SELECT helm_accounts_id, id FROM customers WHERE helm_accounts_id IS NOT NULL`);
    const custByAcct = new Map(cm.rows.map(r => [String(r.helm_accounts_id).trim().toLowerCase(), r.id]));

    while (page <= 3000) {
      let list;
      try { list = await fetchShipmentsPage(isoDay(from), isoDay(to), page, 100); }
      catch (e) { console.error(`[voila-backfill] fetch page ${page}: ${e.message}`); break; }
      if (!list.length) break;
      const firstId = list[0] && list[0].id;
      if (firstId != null && firstId === lastFirstId) break;   // API ignoring page param
      lastFirstId = firstId;

      // Build + insert this page (dedupe ids within the page).
      const seen = new Set();
      const rows = [];
      for (const s of list) {
        const key = String(s.id);
        if (seen.has(key)) continue; seen.add(key);
        const rs = parseRS(s.request_shipment);
        const accountsId = (rs && rs.accounts_id) || s.account_name || s.account_number || null;
        const customerId = accountsId ? (custByAcct.get(String(accountsId).trim().toLowerCase()) || null) : null;
        const p = countShipmentParcels(s, rs);
        const it = countShipmentItems(rs);
        const despatched = s.created_at || s.collection_date || (rs && rs.collection_date) || null;
        const day = despatched ? String(despatched).slice(0, 10) : null;
        if (customerId) attributed++;
        parcels += p; items += it;
        rows.push([key, customerId, accountsId, s.courier || null, s.reference || null, s.ship_to_name || null,
          s.ship_to_postcode || null, p, it, s.collection_date ? String(s.collection_date).slice(0, 10) : null, day, !!s.cancelled]);
      }
      try {
        const ph = rows.map((_, j) => { const b = j * 12; return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12})`; });
        if (rows.length) {
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
          `, rows.flat());
          stored += rows.length;
        }
      } catch (e) { pageErrors++; console.warn(`[voila-backfill] insert page ${page}: ${e.message}`); }

      if (page % 10 === 0) console.log(`[voila-backfill] page ${page}, stored ${stored}`);
      page++;
      if (pageDelayMs) await sleep(pageDelayMs);
    }

    // Rebuild the daily totals once, by despatch date.
    await query(`UPDATE shipments SET dispatched_at = collection_date WHERE dispatched_at IS NULL AND collection_date IS NOT NULL`);
    await query(`DELETE FROM customer_volume_snapshots`);
    await query(`
      INSERT INTO customer_volume_snapshots (customer_id, snapshot_date, parcel_count, item_count)
      SELECT customer_id, dispatched_at, SUM(parcel_count)::int, SUM(item_count)::int
      FROM shipments WHERE cancelled = false AND customer_id IS NOT NULL AND dispatched_at IS NOT NULL
      GROUP BY customer_id, dispatched_at`);

    let health = 0;
    try { health = await recomputeHealthAll(); } catch (e) { console.warn('[voila-backfill] health:', e.message); }

    const detail = `${stored} shipments, ${parcels} parcels, ${items} items, ${attributed} attributed, ${pageErrors} page errors, health ${health}`;
    if (logId) await query(`UPDATE helm_sync_log SET status='ok', records=$1, detail=$2, ran_at=NOW() WHERE id=$3`, [stored, detail, logId]);
    else await query(`INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('voila_backfill','ok',$1,$2)`, [stored, detail]);
    console.log('✅ Voila backfill complete:', detail);
    return { stored, parcels, items, attributed };
  } catch (err) {
    console.error('❌ voila-backfill error:', err.message);
    const msg = `${err.message} (stored ${stored} before failing)`;
    if (logId) await query(`UPDATE helm_sync_log SET status='error', records=$1, detail=$2, ran_at=NOW() WHERE id=$3`, [stored, msg, logId]).catch(() => {});
    else await query(`INSERT INTO helm_sync_log (sync_type, status, records, detail) VALUES ('voila_backfill','error',$1,$2)`, [stored, msg]).catch(() => {});
    return { stored, error: err.message };
  }
}

router.post('/backfill', async (req, res, next) => {
  try {
    if (!voilaConfigured()) {
      return res.status(503).json({ error: 'Voila API not configured — set VOILA_API_USER / VOILA_API_TOKEN in server/.env' });
    }
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
    res.status(202).json({ status: 'started', days, message: `Backfilling ${days} days of Voila shipments in the background. Check GET /api/helm/sync-log.` });
    setImmediate(() => runVoilaBackfill(days));
  } catch (err) { next(err); }
});

export default router;
