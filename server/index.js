import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import customersRouter from './routes/customers.js';
import staffRouter from './routes/staff.js';
import carriersRouter from './routes/carriers.js';
import customerPricingRouter from './routes/customerPricing.js';
import webhooksRouter from './routes/webhooks.js';
import { runMigrations } from './db/migrate.js';
import { seedCustomerRates } from './scripts/seedCustomerRates.js';
import customerRatesRouter from './routes/customerRates.js';
import trackingRouter, { catchUpVerified, purgeOldTrackingData } from './routes/tracking.js';
import billingRouter, { runBillingCycle } from './routes/billing.js';
import { query as dbQuery } from './db/index.js';
import carrierRateCardsRouter, { activateDueCarrierRateCards } from './routes/carrierRateCards.js';
import customerRateCardsRouter from './routes/customerRateCards.js';
import carrierDataRouter from './routes/carrierData.js';
import queriesRouter from './routes/queries.js';
import surchargesRouter from './routes/surcharges.js';
import customerCarrierLinksRouter from './routes/customerCarrierLinks.js';
import slaRulesRouter from './routes/slaRules.js';
import settingsRouter from './routes/settings.js';
import katanaRouter from './routes/katana.js';
import pricingRouter from './routes/pricing.js';
import xeroRouter from './routes/xero.js';
import authRouter from './routes/auth.js';
import reconciliationRouter from './routes/reconciliation.js';
import emailRouter from './routes/email.js';
import { sendAlert } from './services/emailService.js';
import gmailRouter from './routes/gmail.js';
import { startGmailSync, backfillEmailBodiesOnce, backfillSentRepliesOnce } from './services/gmailSync.js';
import { runSlaScreamScan } from './services/slaMonitor.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const isProd = process.env.NODE_ENV === 'production';

// ─── Middleware ───────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000' }));
app.use(express.json({ limit: '10mb' })); // larger limit for CSV import payloads
app.use(morgan(isProd ? 'combined' : 'dev'));

// ─── API Routes ──────────────────────────────────────────────
app.use('/api/auth',                  authRouter);
app.use('/api/customers',             customersRouter);
app.use('/api/staff',                 staffRouter);
app.use('/api/carriers',              carriersRouter);
app.use('/api/customer-pricing',      customerPricingRouter);
app.use('/api/customer-rates',        customerRatesRouter);
app.use('/api/v1/webhooks',           webhooksRouter);
app.use('/api/tracking',              trackingRouter);
app.use('/api/billing',               billingRouter);
app.use('/api/carrier-rate-cards',    carrierRateCardsRouter);
app.use('/api/customer-rate-cards',   customerRateCardsRouter);
app.use('/api/carrier-data',          carrierDataRouter);
app.use('/api/queries',               queriesRouter);
app.use('/api/surcharges',            surchargesRouter);
app.use('/api/customer-carrier-links', customerCarrierLinksRouter);
app.use('/api/sla',                   slaRulesRouter);
app.use('/api/settings',              settingsRouter);
app.use('/api/katana',                katanaRouter);
app.use('/api/pricing',               pricingRouter);
app.use('/api/xero',                  xeroRouter);
// Webhook-safe alias — suppliers that block URLs containing "billing"
// should send to /api/moov-charges/webhook instead
app.use('/api/moov-charges',          billingRouter);
app.use('/api/reconciliation',        reconciliationRouter);
app.use('/api/email',                 emailRouter);
app.use('/api/gmail',                 gmailRouter);

// ─── Health check ────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'moov-os' }));

// ─── Serve built React app in production ─────────────────────
if (isProd) {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// ─── Error handler ───────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// ─── Startup ─────────────────────────────────────────────────
async function start() {
  // Check DATABASE_URL is set before attempting anything
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is not set.');
    console.error('   On Railway: add a PostgreSQL plugin to your service, or set DATABASE_URL manually.');
    process.exit(1);
  }

  try {
    await runMigrations();
    await seedCustomerRates();
    await catchUpVerified();
    await purgeOldTrackingData();
    await activateDueCarrierRateCards();
    // Re-run purge every 24 hours
    setInterval(purgeOldTrackingData, 24 * 60 * 60 * 1000);
    // Re-check rate card activation every 24 hours (catches date-boundary activations)
    setInterval(activateDueCarrierRateCards, 24 * 60 * 60 * 1000);
    // Billing cycle scheduler — checks every minute whether a billing run is due
    startBillingScheduler();
    // Webhook health monitor — checks every 5 minutes during UK business hours
    startWebhookHealthMonitor();
    startGmailSync(3 * 60 * 1000); // poll every 3 minutes
    // SLA scream monitor — escalate breached tickets to Google Chat every 5 min.
    setInterval(() => { runSlaScreamScan().catch(e => console.warn('[SLA] scan error:', e.message)); }, 5 * 60 * 1000);
    // One-time repair of emails imported before the body-parsing fix.
    // Fire-and-forget so it can never delay or crash startup.
    backfillEmailBodiesOnce().catch(e => console.warn('[Email backfill] skipped:', e.message));
    // One-time: pull SENT replies into existing threads so they become two-sided.
    backfillSentRepliesOnce().catch(e => console.warn('[Sent backfill] skipped:', e.message));
  } catch (err) {
    console.error('❌ Migration failed — server will not start.');
    console.error('   Error code:   ', err.code    || 'unknown');
    console.error('   Error detail: ', err.detail  || err.message || err);
    console.error('   Hint:         ', err.hint    || 'Check your DATABASE_URL and that your PostgreSQL service is running.');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`🟢 Moov OS server running on port ${PORT}`);
  });
}

// ─── Billing cycle scheduler ─────────────────────────────────────────────────
// Checks every minute whether a billing run is due based on billing_settings.
// Runs the cycle at most once per day to prevent double-firing on server restart.

function startBillingScheduler() {
  let lastRunDate = null; // track date string 'YYYY-MM-DD' of last automatic run

  setInterval(async () => {
    try {
      const settingsRes = await dbQuery(`SELECT * FROM billing_settings WHERE id = 1`);
      const s = settingsRes.rows[0];
      if (!s || !s.enabled) return;

      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      // Already ran today — skip
      if (lastRunDate === todayStr) return;

      // Check time match
      if (now.getDay()     !== s.billing_day_of_week) return;
      if (now.getHours()   !== s.billing_hour)        return;
      if (now.getMinutes() !== s.billing_minute)      return;

      console.log(`⏰ Billing scheduler: running cycle for ${todayStr}`);
      lastRunDate = todayStr;

      const result = await runBillingCycle(now);
      await dbQuery(`UPDATE billing_settings SET last_run_at = NOW() WHERE id = 1`);
      console.log(`✅ Billing cycle complete — ${result.charges_queued} charges queued across ${result.customers_processed} customers`);
    } catch (err) {
      console.error('❌ Billing scheduler error:', err.message);
    }
  }, 60 * 1000); // every minute

  console.log('🗓️  Billing scheduler started');
}

// ─── Webhook health monitor ───────────────────────────────────────────────────
// Runs every 5 minutes. During UK business hours (Mon–Fri 08:00–17:00, excluding
// bank holidays) checks how long ago the last tracking event was received.
// If the gap exceeds the configured threshold, fires a webhook_gap alert.

// In-memory cache of UK bank holidays (refreshed daily from GOV.UK API)
let ukBankHolidays = new Set();
let bankHolidayFetchedDate = null;

async function refreshBankHolidays() {
  const today = new Date().toISOString().split('T')[0];
  if (bankHolidayFetchedDate === today) return;
  try {
    const res = await fetch('https://www.gov.uk/bank-holidays.json');
    if (!res.ok) return;
    const data = await res.json();
    const events = data['england-and-wales']?.events || [];
    ukBankHolidays = new Set(events.map(e => e.date));
    bankHolidayFetchedDate = today;
  } catch {
    // Non-fatal — keep using whatever we had before
  }
}

function isUkBusinessHours() {
  // Use UK local time (Europe/London handles GMT/BST automatically)
  const ukNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
  const dayOfWeek = ukNow.getDay(); // 0=Sun, 6=Sat
  const hour      = ukNow.getHours();
  const dateStr   = ukNow.toISOString().split('T')[0];

  if (dayOfWeek === 0 || dayOfWeek === 6) return false;  // weekend
  if (ukBankHolidays.has(dateStr))         return false;  // bank holiday
  if (hour < 8 || hour >= 17)              return false;  // outside 08:00–17:00
  return true;
}

function startWebhookHealthMonitor() {
  setInterval(async () => {
    try {
      await refreshBankHolidays();
      if (!isUkBusinessHours()) return;

      // Load alert settings
      const alertRes = await dbQuery(
        `SELECT at.*, (SELECT json_agg(r) FROM email_alert_recipients r WHERE r.alert_type_id = at.id AND r.enabled = true) AS recipients
         FROM email_alert_types at WHERE code = 'webhook_gap'`
      );
      const alert = alertRes.rows[0];
      if (!alert || !alert.enabled) return;

      const settings       = alert.settings || {};
      const thresholdMins  = settings.threshold_minutes ?? 10;
      const cooldownMins   = settings.cooldown_minutes  ?? 30;

      // Cooldown check
      if (alert.last_alerted_at) {
        const msSince = Date.now() - new Date(alert.last_alerted_at).getTime();
        if (msSince < cooldownMins * 60 * 1000) return;
      }

      // Check last tracking event received
      const evtRes = await dbQuery(`SELECT MAX(created_at) AS last_at FROM tracking_events`);
      const lastAt  = evtRes.rows[0]?.last_at;
      const gapMs   = lastAt ? Date.now() - new Date(lastAt).getTime() : Infinity;
      const gapMins = gapMs / 60000;

      if (gapMins >= thresholdMins) {
        console.warn(`⚠️  Webhook health: no events for ${Math.round(gapMins)} min — sending alert`);
        await sendAlert('webhook_gap', {
          gap_minutes:      Math.round(gapMins),
          last_webhook_at:  lastAt || null,
        });
      }
    } catch (err) {
      console.error('❌ Webhook health monitor error:', err.message);
    }
  }, 5 * 60 * 1000); // every 5 minutes

  console.log('📡 Webhook health monitor started');
}

start();
