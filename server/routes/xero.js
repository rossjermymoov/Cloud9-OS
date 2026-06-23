/**
 * Cloud9 OS — Xero OAuth 2.0 integration (read-focused).
 *
 * Mounted WITHOUT global auth so /connect + /callback (browser redirects from
 * Xero, no JWT) work. Every data endpoint is guarded with requireAuth.
 *
 *   GET    /api/xero/status                      — connection status
 *   GET    /api/xero/connect                     — redirect to Xero consent
 *   GET    /api/xero/callback                    — OAuth callback (public)
 *   DELETE /api/xero/disconnect                  — drop stored tokens
 *   GET    /api/xero/contacts/search?q=          — search Xero contacts
 *   GET    /api/xero/customers/match-status      — customers + link status + suggestions
 *   PUT    /api/xero/customers/:id/link          — link a customer to a Xero contact
 *   DELETE /api/xero/customers/:id/link          — unlink
 *   POST   /api/xero/customers/auto-match        — fuzzy auto-match unlinked customers
 *   GET    /api/xero/customers/:id/finance       — live outstanding invoices for a customer
 *
 * Env: XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI
 */
import express from 'express';
import { query } from '../db/index.js';
import { requireAuth } from './auth.js';

const router = express.Router();

const XERO_AUTH_URL  = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_CONN_URL  = 'https://api.xero.com/connections';
const XERO_API_BASE  = 'https://api.xero.com/api.xro/2.0';

const SCOPES = [
  'openid', 'profile', 'email',
  'offline_access',
  'accounting.contacts.read',
  'accounting.invoices.read',
].join(' ');

const xeroConfigured = () => !!(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET && process.env.XERO_REDIRECT_URI);

// ─── Token helpers ───────────────────────────────────────────────────────────
async function getStoredToken() {
  const r = await query('SELECT * FROM xero_tokens ORDER BY id DESC LIMIT 1');
  return r.rows[0] || null;
}

async function refreshXeroToken(token) {
  const creds = Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64');
  const resp = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token }).toString(),
  });
  if (!resp.ok) throw new Error(`Xero token refresh failed: ${await resp.text()}`);
  const data = await resp.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);
  await query(`UPDATE xero_tokens SET access_token=$1, refresh_token=$2, expires_at=$3, updated_at=NOW() WHERE id=$4`,
    [data.access_token, data.refresh_token, expiresAt, token.id]);
  return { ...token, access_token: data.access_token, expires_at: expiresAt };
}

async function getValidToken() {
  const token = await getStoredToken();
  if (!token) throw new Error('Not connected to Xero');
  if (new Date(token.expires_at) - new Date() < 5 * 60 * 1000) return refreshXeroToken(token);
  return token;
}

async function xeroRequest(method, path, body = null) {
  const token = await getValidToken();
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Xero-tenant-id': token.tenant_id,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${XERO_API_BASE}${path}`, opts);
  if (!resp.ok) throw new Error(`Xero API error ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

// Xero dates arrive as /Date(ms+offset)/ — normalise to YYYY-MM-DD.
function parseXeroDate(d) {
  if (!d) return null;
  const m = String(d).match(/\/Date\((\d+)([+-]\d+)?\)\//);
  if (m) return new Date(parseInt(m[1])).toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

// ─── Name matching ───────────────────────────────────────────────────────────
const COMPANY_SUFFIXES = /\b(limited|ltd|plc|llp|llc|inc|incorporated|co|company|group|holdings|services|solutions|enterprises|trading|international)\b\.?/gi;
const normaliseName = (s) => s.replace(COMPANY_SUFFIXES, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
function nameMatchScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const na = normaliseName(a), nb = normaliseName(b);
  if (na.length > 0 && na === nb) return 0.97;
  if (na.length > 0 && nb.length > 0 && (na.includes(nb) || nb.includes(na))) {
    return Math.max(0.78, Math.min(na.length, nb.length) / Math.max(na.length, nb.length));
  }
  const wa = new Set(na.split(/\s+/).filter(w => w.length > 1));
  const wb = new Set(nb.split(/\s+/).filter(w => w.length > 1));
  if (!wa.size || !wb.size) return 0;
  const common = [...wa].filter(w => wb.has(w)).length;
  const total = new Set([...wa, ...wb]).size;
  return total ? common / total : 0;
}

// ─── OAuth ───────────────────────────────────────────────────────────────────
router.get('/status', requireAuth, async (_req, res, next) => {
  try {
    if (!xeroConfigured()) return res.json({ connected: false, configured: false });
    const token = await getStoredToken();
    if (!token) return res.json({ connected: false, configured: true });
    res.json({ connected: true, configured: true, tenant_name: token.tenant_name, tenant_id: token.tenant_id,
               expires_at: token.expires_at, needs_refresh: new Date(token.expires_at) < new Date() });
  } catch (err) { next(err); }
});

router.get('/connect', (req, res) => {
  if (!xeroConfigured()) return res.status(500).send('Xero is not configured (XERO_CLIENT_ID/SECRET/REDIRECT_URI).');
  const params = new URLSearchParams({
    response_type: 'code', client_id: process.env.XERO_CLIENT_ID,
    redirect_uri: process.env.XERO_REDIRECT_URI, scope: SCOPES, state: Math.random().toString(36).slice(2),
  });
  res.redirect(`${XERO_AUTH_URL}?${params.toString()}`);
});

router.get('/callback', async (req, res, next) => {
  try {
    const { code, error } = req.query;
    if (error) return res.redirect(`/settings?tab=xero&error=${encodeURIComponent(error)}`);
    if (!code) return res.redirect('/settings?tab=xero&error=no_code');
    const creds = Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64');
    const tokenResp = await fetch(XERO_TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: process.env.XERO_REDIRECT_URI }).toString(),
    });
    if (!tokenResp.ok) { console.error('[xero] token exchange failed:', await tokenResp.text()); return res.redirect('/settings?tab=xero&error=token_exchange_failed'); }
    const tokenData = await tokenResp.json();
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
    const connResp = await fetch(XERO_CONN_URL, { headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' } });
    const tenant = (await connResp.json())[0] || {};
    await query('DELETE FROM xero_tokens');
    await query(`INSERT INTO xero_tokens (access_token, refresh_token, tenant_id, tenant_name, expires_at) VALUES ($1,$2,$3,$4,$5)`,
      [tokenData.access_token, tokenData.refresh_token, tenant.tenantId, tenant.tenantName, expiresAt]);
    res.redirect('/settings?tab=xero&connected=1');
  } catch (err) { next(err); }
});

router.delete('/disconnect', requireAuth, async (_req, res, next) => {
  try { await query('DELETE FROM xero_tokens'); res.json({ ok: true }); } catch (err) { next(err); }
});

// ─── Contacts + linking ──────────────────────────────────────────────────────
router.get('/contacts/search', requireAuth, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ contacts: [] });
    const data = await xeroRequest('GET', `/Contacts?searchTerm=${encodeURIComponent(q)}&includeArchived=false`);
    res.json({ contacts: (data.Contacts || []).map(c => ({ id: c.ContactID, name: c.Name, email: c.EmailAddress || null, status: c.ContactStatus })) });
  } catch (err) { next(err); }
});

router.get('/customers/match-status', requireAuth, async (_req, res, next) => {
  try {
    const { rows: customers } = await query(`SELECT id, business_name, xero_contact_id, xero_contact_name FROM customers ORDER BY business_name ASC`);
    const suggestions = {};
    const unlinked = customers.filter(c => !c.xero_contact_id);
    const needsName = customers.filter(c => c.xero_contact_id && !c.xero_contact_name);
    if (unlinked.length || needsName.length) {
      try {
        const data = await xeroRequest('GET', '/Contacts?includeArchived=false&pageSize=1000');
        const xeroContacts = data.Contacts || [];
        const byId = {}; for (const xc of xeroContacts) byId[xc.ContactID] = xc.Name;
        for (const cust of needsName) {
          const name = byId[cust.xero_contact_id];
          if (name) { await query(`UPDATE customers SET xero_contact_name=$1 WHERE id=$2`, [name, cust.id]); cust.xero_contact_name = name; }
        }
        for (const cust of unlinked) {
          const name = (cust.business_name || '').toLowerCase().trim();
          let best = null, bestScore = 0;
          for (const xc of xeroContacts) { const s = nameMatchScore(name, (xc.Name || '').toLowerCase().trim()); if (s > bestScore) { bestScore = s; best = xc; } }
          if (best && bestScore >= 0.4) suggestions[cust.id] = { xero_id: best.ContactID, xero_name: best.Name, score: Math.round(bestScore * 100) };
        }
      } catch (e) { console.warn('[xero match-status]', e.message); }
    }
    res.json({ customers, suggestions });
  } catch (err) { next(err); }
});

router.put('/customers/:id/link', requireAuth, async (req, res, next) => {
  try {
    const { xero_contact_id, xero_contact_name } = req.body || {};
    if (!xero_contact_id) return res.status(400).json({ error: 'xero_contact_id required' });
    await query(`UPDATE customers SET xero_contact_id=$1, xero_contact_name=$2 WHERE id=$3`, [xero_contact_id, xero_contact_name || null, req.params.id]);
    res.json({ ok: true, xero_contact_id, xero_contact_name });
  } catch (err) { next(err); }
});

router.delete('/customers/:id/link', requireAuth, async (req, res, next) => {
  try { await query(`UPDATE customers SET xero_contact_id=NULL, xero_contact_name=NULL, ledger_balance=NULL WHERE id=$1`, [req.params.id]); res.json({ ok: true }); }
  catch (err) { next(err); }
});

router.post('/customers/auto-match', requireAuth, async (_req, res, next) => {
  try {
    const data = await xeroRequest('GET', '/Contacts?includeArchived=false&pageSize=1000');
    const xeroContacts = data.Contacts || [];
    const { rows: customers } = await query(`SELECT id, business_name FROM customers WHERE xero_contact_id IS NULL ORDER BY business_name`);
    const matched = [], suggestions = [];
    for (const cust of customers) {
      const name = (cust.business_name || '').toLowerCase().trim();
      let best = null, bestScore = 0;
      for (const xc of xeroContacts) { const s = nameMatchScore(name, (xc.Name || '').toLowerCase().trim()); if (s > bestScore) { bestScore = s; best = xc; } }
      if (best && bestScore >= 0.8) {
        await query(`UPDATE customers SET xero_contact_id=$1, xero_contact_name=$2 WHERE id=$3`, [best.ContactID, best.Name, cust.id]);
        matched.push({ customer_id: cust.id, customer_name: cust.business_name, xero_name: best.Name, score: Math.round(bestScore * 100) });
      } else if (best && bestScore >= 0.5) {
        suggestions.push({ customer_id: cust.id, customer_name: cust.business_name, xero_id: best.ContactID, xero_name: best.Name, score: Math.round(bestScore * 100) });
      }
    }
    res.json({ matched, suggestions });
  } catch (err) { next(err); }
});

// ─── Per-customer finance (live outstanding invoices) ────────────────────────
router.get('/customers/:id/finance', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT id, business_name, credit_limit, xero_contact_id, xero_contact_name FROM customers WHERE id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Customer not found' });
    const c = rows[0];
    const creditLimit = parseFloat(c.credit_limit) || 0;
    if (!c.xero_contact_id) return res.json({ linked: false, xero_connected: !!(await getStoredToken().catch(() => null)), credit_limit: creditLimit, invoices: [] });

    let invoices = [], outstanding = 0, xeroConnected = false, error = null;
    try {
      if (await getStoredToken()) {
        xeroConnected = true;
        const data = await xeroRequest('GET', `/Invoices?ContactIDs=${c.xero_contact_id}&Statuses=AUTHORISED&order=DueDate ASC`);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        invoices = (data.Invoices || []).map(inv => {
          const due = parseXeroDate(inv.DueDate);
          return { id: inv.InvoiceID, number: inv.InvoiceNumber, date: parseXeroDate(inv.Date), due_date: due,
                   amount_due: parseFloat(inv.AmountDue || 0), total: parseFloat(inv.Total || 0), is_overdue: due ? new Date(due) < today : false };
        });
        outstanding = invoices.reduce((s, i) => s + i.amount_due, 0);
        await query(`UPDATE customers SET ledger_balance=$1 WHERE id=$2`, [Math.round(outstanding * 100) / 100, c.id]).catch(() => {});
      }
    } catch (e) { error = e.message; console.warn('[xero finance]', e.message); }

    const utilisation = creditLimit > 0 ? Math.round((outstanding / creditLimit) * 1000) / 10 : null;
    res.json({
      linked: true, xero_connected: xeroConnected, xero_contact_name: c.xero_contact_name,
      credit_limit: creditLimit, outstanding: Math.round(outstanding * 100) / 100,
      utilisation_pct: utilisation, credit_status: utilisation == null ? 'no_limit' : utilisation >= 100 ? 'over_limit' : utilisation >= 90 ? 'warning' : 'ok',
      overdue_count: invoices.filter(i => i.is_overdue).length, invoices, error,
    });
  } catch (err) { next(err); }
});

export default router;
