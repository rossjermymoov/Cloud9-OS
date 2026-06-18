import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { runMigrations } from './db/migrate.js';
import customersRouter     from './routes/customers.js';
import trackingRouter, { clearPendingCollection } from './routes/tracking.js';
import webhooksRouter      from './routes/webhooks.js';
import notificationsRouter from './routes/notifications.js';
import helmRouter, { syncPurchaseOrders } from './routes/helm.js';
import { helmConfigured }  from './services/helmClient.js';
import volumeRouter        from './routes/volume.js';
import purchaseOrdersRouter from './routes/purchaseOrders.js';
import returnsRouter        from './routes/returns.js';
import voilaRouter, { runVoilaBackfill } from './routes/voila.js';
import { voilaConfigured }  from './services/voilaClient.js';
import pickingRouter        from './routes/picking.js';
import { syncPicks }        from './services/pickingService.js';
import slaRouter            from './routes/sla.js';
import { syncRecentOrders, syncOrderStatuses } from './services/slaService.js';
import { syncBankHolidays } from './services/bankHolidayService.js';
import authRouter, { requireAuth } from './routes/auth.js';
import warehouseRouter      from './routes/warehouse.js';
import storageRouter        from './routes/storage.js';
import { syncStorage }       from './services/storageService.js';
import queriesRouter        from './routes/queries.js';
import emailRouter          from './routes/email.js';
import gmailRouter          from './routes/gmail.js';
import slaRulesRouter       from './routes/slaRules.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const isProd = process.env.NODE_ENV === 'production';

// ─── Middleware ──────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000' }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan(isProd ? 'combined' : 'dev'));

// ─── API Routes ──────────────────────────────────────────────
// Auth is public (its handlers gate themselves). Webhooks use the webhook token,
// NOT user login, so they stay open for Helm/Voila. Everything else requires a
// valid session via requireAuth (which lets requests through only during
// first-run setup, when no users exist yet).
app.use('/api/auth',          authRouter);
app.use('/api/v1/webhooks',   webhooksRouter);
app.use('/api/warehouse',     warehouseRouter);   // public, read-only TV board

app.use('/api/customers',     requireAuth, customersRouter);
app.use('/api/tracking',      requireAuth, trackingRouter);
app.use('/api/notifications', requireAuth, notificationsRouter);
app.use('/api/helm',          requireAuth, helmRouter);
app.use('/api/volume',        requireAuth, volumeRouter);
app.use('/api/purchase-orders', requireAuth, purchaseOrdersRouter);
app.use('/api/returns',         requireAuth, returnsRouter);
app.use('/api/voila',           requireAuth, voilaRouter);
app.use('/api/picking',         requireAuth, pickingRouter);
app.use('/api/storage',         requireAuth, storageRouter);
app.use('/api/sla',             requireAuth, slaRouter);

// Queries & Claims module (ported from Moov OS). slaRules mounts at /api/sla-rules
// to avoid clashing with Cloud9's dispatch SLA above.
app.use('/api/queries',         requireAuth, queriesRouter);
app.use('/api/email',           requireAuth, emailRouter);
app.use('/api/gmail',           requireAuth, gmailRouter);
app.use('/api/sla-rules',       requireAuth, slaRulesRouter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'cloud9-os' }));

// ─── Serve built React app in production ─────────────────────
if (isProd) {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// ─── Error handler ───────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ─── Startup ─────────────────────────────────────────────────
async function start() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set. Add a PostgreSQL service or set DATABASE_URL.');
    process.exit(1);
  }
  try {
    await runMigrations();
  } catch (err) {
    console.error('❌ Migration failed — server will not start.', err.message);
    process.exit(1);
  }
  app.listen(PORT, () => console.log(`🟢 Cloud9 OS server running on port ${PORT}`));

  // Auto-sync purchase orders from Helm every 30 minutes.
  if (helmConfigured()) {
    const POLL = 30 * 60 * 1000;
    setTimeout(() => syncPurchaseOrders().catch(e => console.warn('[po-auto-sync]', e.message)), 60 * 1000);
    setInterval(() => syncPurchaseOrders().catch(e => console.warn('[po-auto-sync]', e.message)), POLL);
    console.log('🗓️  PO auto-sync scheduled every 30 minutes');

    // Pick performance: refresh recent picks hourly (light — detail only for
    // completed picks). A 2-day window catches same-day + late completions.
    setTimeout(() => syncPicks(2, { pickDelayMs: 60 }).catch(e => console.warn('[picking-sync]', e.message)), 90 * 1000);
    setInterval(() => syncPicks(2, { pickDelayMs: 60 }).catch(e => console.warn('[picking-sync]', e.message)), 60 * 60 * 1000);
    console.log('🧺 Picking auto-sync scheduled hourly');

    // On-time SLA: refresh recent orders (received + dispatched times) hourly.
    setTimeout(() => syncRecentOrders(14).catch(e => console.warn('[sla-sync]', e.message)), 120 * 1000);
    setInterval(() => syncRecentOrders(14).catch(e => console.warn('[sla-sync]', e.message)), 60 * 60 * 1000);
    console.log('⏱️  SLA order auto-sync scheduled hourly');

    // Live warehouse pipeline: refresh order statuses (Picking/Packing/etc) every
    // 5 minutes so the TV board reflects what's actually moving.
    setTimeout(() => syncOrderStatuses(1).catch(e => console.warn('[status-sync]', e.message)), 30 * 1000);
    setInterval(() => syncOrderStatuses(1).catch(e => console.warn('[status-sync]', e.message)), 5 * 60 * 1000);
    console.log('🏭 Order-status auto-sync scheduled every 5 minutes');
  }

  // Clear "pending collection" to 0 every night at 20:00 UK — couriers have been
  // by then, so anything still awaiting collection is marked collected.
  {
    let lastClear = null;
    setInterval(() => {
      const uk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
      const key = `${uk.getFullYear()}-${uk.getMonth()}-${uk.getDate()}`;
      if (uk.getHours() === 20 && uk.getMinutes() === 0 && lastClear !== key) {
        lastClear = key;
        clearPendingCollection().catch(e => console.warn('[clear-pending]', e.message));
      }
    }, 60 * 1000);
    console.log('🌙 Pending-collection clear scheduled for 20:00 UK');
  }

  // Storage footprint (m³ per client) — recompute nightly at 03:00 UK (slow,
  // detail-per-SKU). Inventory changes slowly, so once a night is plenty.
  if (helmConfigured()) {
    let lastStorage = null;
    setInterval(() => {
      const uk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
      const key = `${uk.getFullYear()}-${uk.getMonth()}-${uk.getDate()}`;
      if (uk.getHours() === 3 && uk.getMinutes() === 0 && lastStorage !== key) {
        lastStorage = key;
        syncStorage().catch(e => console.warn('[storage-sync]', e.message));
      }
    }, 60 * 1000);
    console.log('📦 Storage footprint sync scheduled for 03:00 UK');
  }

  // UK bank holidays — refresh on boot and weekly (independent of Helm).
  syncBankHolidays().catch(e => console.warn('[bank-holidays]', e.message));
  setInterval(() => syncBankHolidays().catch(e => console.warn('[bank-holidays]', e.message)), 7 * 24 * 60 * 60 * 1000);

  // Nightly full Voila backfill at 19:00 UK time — runs gently overnight so the
  // 9am management numbers are always complete, even if a webhook was missed.
  if (voilaConfigured()) {
    let lastNightly = null;
    setInterval(() => {
      const uk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
      const key = `${uk.getFullYear()}-${uk.getMonth()}-${uk.getDate()}`;
      if (uk.getHours() === 19 && uk.getMinutes() === 0 && lastNightly !== key) {
        lastNightly = key;
        console.log('🌙 Nightly Voila backfill starting (19:00 UK)…');
        runVoilaBackfill(90, { pageDelayMs: 400 }).catch(e => console.warn('[nightly-backfill]', e.message));
      }
    }, 60 * 1000);
    console.log('🌙 Nightly Voila backfill scheduled for 19:00 UK');
  }
}

start();
