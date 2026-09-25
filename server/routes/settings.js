import express from 'express';
import { getSetting, setSetting } from '../services/appSettings.js';
import { getHelmConfig, testHelmCredentials, clearHelmTokenCache } from '../services/helmClient.js';

const router = express.Router();

const WELCOME_KEY = 'board_welcome';
const URGENT_KEY  = 'board_urgent';
const BRANDING_KEY = 'branding';
const HELM_KEY    = 'helm_integration';

const DEFAULT_BRANDING = {
  app_name: 'Cloud9 OS',
  company_name: 'Cloud9 Fulfillment',
  logo_url: '',
  primary_color: '#0056FB',
};

// Shape the stored settings into the live state the UI/board care about.
function activeUrgent(u) {
  if (!u || !u.message) return null;
  if (u.expires_at && new Date(u.expires_at).getTime() <= Date.now()) return null;  // timer elapsed
  return { message: u.message, expires_at: u.expires_at || null };
}
function activeWelcome(w) {
  if (!w || !w.enabled || !String(w.who || '').trim()) return null;
  return { who: String(w.who).trim() };
}

// ─── Branding Settings ───────────────────────────────────────────────────────
router.get('/branding', async (_req, res, next) => {
  try {
    const b = await getSetting(BRANDING_KEY, DEFAULT_BRANDING);
    res.json({ ...DEFAULT_BRANDING, ...(b || {}) });
  } catch (err) { next(err); }
});

router.put('/branding', async (req, res, next) => {
  try {
    const cur = await getSetting(BRANDING_KEY, DEFAULT_BRANDING);
    const updated = {
      app_name: String(req.body?.app_name || cur.app_name || 'Warehouse OS').trim().slice(0, 60),
      company_name: String(req.body?.company_name || cur.company_name || '').trim().slice(0, 100),
      logo_url: String(req.body?.logo_url || '').trim().slice(0, 500),
      primary_color: String(req.body?.primary_color || cur.primary_color || '#0056FB').trim().slice(0, 20),
    };
    await setSetting(BRANDING_KEY, updated);
    res.json(updated);
  } catch (err) { next(err); }
});

// ─── Helm Integration Settings ───────────────────────────────────────────────
router.get('/helm-integration', async (_req, res, next) => {
  try {
    const cfg = await getHelmConfig();
    const isConfigured = Boolean(cfg.baseUrl && cfg.email && cfg.password);
    const maskEmail = (em) => {
      if (!em || !em.includes('@')) return em || '';
      const [u, d] = em.split('@');
      return `${u.slice(0, 2)}•••@${d}`;
    };

    res.json({
      configured: isConfigured,
      base_url: cfg.baseUrl,
      email: maskEmail(cfg.email),
      has_password: Boolean(cfg.password),
      has_2fa: Boolean(cfg.twoFaCode),
      source: cfg.source,
    });
  } catch (err) { next(err); }
});

router.post('/helm-test', async (req, res, next) => {
  try {
    const { base_url, email, password, two_fa_code } = req.body || {};
    const result = await testHelmCredentials({
      baseUrl: base_url,
      email,
      password,
      twoFaCode: two_fa_code,
    });
    res.json({ ok: true, message: 'Successfully connected to Helm API!' });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.put('/helm-integration', async (req, res, next) => {
  try {
    const { base_url, email, password, two_fa_code } = req.body || {};
    if (!base_url || !email) {
      return res.status(400).json({ error: 'Base URL and email are required' });
    }

    const cur = await getHelmConfig();
    const finalPassword = password || cur.password;
    if (!finalPassword) {
      return res.status(400).json({ error: 'Password is required' });
    }

    // Verify before saving
    await testHelmCredentials({
      baseUrl: base_url,
      email,
      password: finalPassword,
      twoFaCode: two_fa_code !== undefined ? two_fa_code : cur.twoFaCode,
    });

    const payload = {
      base_url: String(base_url).trim().replace(/\/$/, ''),
      email: String(email).trim(),
      password: finalPassword,
      two_fa_code: two_fa_code || '',
      updated_at: new Date().toISOString(),
    };

    await setSetting(HELM_KEY, payload);
    clearHelmTokenCache();

    res.json({ ok: true, message: 'Helm credentials saved and verified!' });
  } catch (err) {
    res.status(400).json({ error: `Connection failed: ${err.message}` });
  }
});

// ─── Warehouse Board Messages ────────────────────────────────────────────────
router.get('/board-messages', async (req, res, next) => {
  try {
    const [w, u] = await Promise.all([getSetting(WELCOME_KEY), getSetting(URGENT_KEY)]);
    // The shareable TV-board URL, with the access key pre-filled if one is set.
    const key = process.env.WAREHOUSE_KEY || null;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const board_url = `${proto}://${req.get('host')}/warehouse${key ? `?key=${encodeURIComponent(key)}` : ''}`;
    res.json({
      board_url, board_locked: !!key,
      welcome: { enabled: !!w?.enabled, who: w?.who || '' },
      urgent:  { message: u?.message || '', expires_at: u?.expires_at || null, active: !!activeUrgent(u) },
    });
  } catch (err) { next(err); }
});

router.put('/board-welcome', async (req, res, next) => {
  try {
    const enabled = !!req.body?.enabled;
    const who = String(req.body?.who || '').slice(0, 200);
    const saved = await setSetting(WELCOME_KEY, { enabled, who });
    res.json(saved);
  } catch (err) { next(err); }
});

// Post / extend an urgent banner. Body: { message, minutes } to show, or { clear:true }.
router.put('/board-urgent', async (req, res, next) => {
  try {
    if (req.body?.clear) { const saved = await setSetting(URGENT_KEY, { message: '', expires_at: null }); return res.json(saved); }
    const message = String(req.body?.message || '').trim().slice(0, 280);
    const minutes = Math.min(720, Math.max(1, parseInt(req.body?.minutes) || 30));
    if (!message) return res.status(400).json({ error: 'message is required' });
    const expires_at = new Date(Date.now() + minutes * 60000).toISOString();
    const saved = await setSetting(URGENT_KEY, { message, expires_at });
    res.json(saved);
  } catch (err) { next(err); }
});

export default router;
