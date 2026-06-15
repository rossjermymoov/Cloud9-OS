import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { runMigrations } from './db/migrate.js';
import customersRouter     from './routes/customers.js';
import trackingRouter      from './routes/tracking.js';
import webhooksRouter      from './routes/webhooks.js';
import notificationsRouter from './routes/notifications.js';
import helmRouter          from './routes/helm.js';
import volumeRouter        from './routes/volume.js';
import purchaseOrdersRouter from './routes/purchaseOrders.js';
import returnsRouter        from './routes/returns.js';

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
app.use('/api/customers',     customersRouter);
app.use('/api/tracking',      trackingRouter);
app.use('/api/v1/webhooks',   webhooksRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/helm',          helmRouter);
app.use('/api/volume',        volumeRouter);
app.use('/api/purchase-orders', purchaseOrdersRouter);
app.use('/api/returns',         returnsRouter);

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
}

start();
