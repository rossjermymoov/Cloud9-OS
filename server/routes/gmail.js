import express from 'express';
import { getAuthUrl, exchangeCodeForTokens, saveTokens, getConfig, disconnect, createOAuthClient } from '../services/gmailService.js';
import { syncGmail } from '../services/gmailSync.js';
import { requireAuth } from './auth.js';
import { google } from 'googleapis';

const router = express.Router();

// NOTE: this router is mounted WITHOUT global auth so the OAuth /auth + /callback
// (which Google hits as a browser redirect, carrying no JWT) can work. Every data
// endpoint below is individually guarded with requireAuth.

router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const config = await getConfig();
    const connected = !!(config?.refresh_token);
    res.json({ connected, email_address: connected ? config.email_address : null, last_sync_at: connected ? config.last_sync_at : null });
  } catch (err) { next(err); }
});

router.get('/auth', (req, res) => {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
    return res.status(500).json({ error: 'GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET not set' });
  }
  res.redirect(getAuthUrl());
});

router.get('/callback', async (req, res, next) => {
  try {
    const { code, error } = req.query;
    if (error) return res.redirect('/settings?tab=gmail&error=' + encodeURIComponent(error));
    if (!code)  return res.redirect('/settings?tab=gmail&error=no_code');
    const tokens = await exchangeCodeForTokens(code);
    const oauth2Client = createOAuthClient();
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    await saveTokens(tokens, profile.data.emailAddress);
    res.redirect('/settings?tab=gmail&connected=1');
  } catch (err) { next(err); }
});

// Manual sync — always resets historyId so it rescans the last 7 days in full
router.post('/sync', requireAuth, async (req, res, next) => {
  try {
    const { query: dbQuery } = await import('../db/index.js');
    await dbQuery('UPDATE gmail_oauth_config SET last_history_id = NULL WHERE id = 1');
    const result = await syncGmail();
    res.json(result);
  } catch (err) {
    console.error('[Gmail sync route]', err);
    res.status(500).json({ error: err.message });
  }
});

// Debug endpoint — lists raw Gmail messages without importing
router.get('/debug', requireAuth, async (req, res, next) => {
  try {
    const config = await getConfig();
    if (!config?.refresh_token) return res.json({ connected: false });
    const { getAuthedClient } = await import('../services/gmailService.js');
    const auth  = await getAuthedClient();
    const gmail = google.gmail({ version: 'v1', auth });
    const since = Math.floor((Date.now() - 7 * 86400000) / 1000);
    const listRes = await gmail.users.messages.list({ userId: 'me', labelIds: ['INBOX'], q: `after:${since}`, maxResults: 10 });
    const messages = listRes.data.messages || [];
    const previews = await Promise.all(messages.slice(0, 5).map(async m => {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
      const h = msg.data.payload?.headers || [];
      return {
        id: m.id, threadId: m.threadId,
        subject: h.find(x => x.name === 'Subject')?.value,
        from:    h.find(x => x.name === 'From')?.value,
        date:    h.find(x => x.name === 'Date')?.value,
      };
    }));
    res.json({ total_in_inbox_last_7d: messages.length, sample: previews, last_history_id: config.last_history_id, last_sync_at: config.last_sync_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test endpoint — inserts one dummy ticket directly to verify the view works
router.post('/test-insert', requireAuth, async (req, res, next) => {
  try {
    const { query: dbQuery } = await import('../db/index.js');
    const qRes = await dbQuery(`
      INSERT INTO queries (customer_name, sender_email, sender_matched, subject, status, query_type, trigger)
      VALUES ('Test Customer', 'test@example.com', false, 'Test ticket from Gmail sync debug', 'open', 'other', 'customer_email')
      RETURNING id, ticket_number
    `);
    const q = qRes.rows[0];
    await dbQuery(`
      INSERT INTO query_emails (query_id, direction, from_address, subject, body_text, received_at, is_ai_draft)
      VALUES ($1, 'inbound_customer', 'test@example.com', 'Test ticket from Gmail sync debug', 'This is a test email body.', NOW(), false)
    `, [q.id]);
    res.json({ ok: true, id: q.id, ticket_number: q.ticket_number });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Force regenerate ALL summaries regardless of existing description
router.post('/regenerate-summaries', requireAuth, async (req, res, next) => {
  try {
    const { query: dbQuery } = await import('../db/index.js');
    const { generateSummary } = await import('../services/gmailSync.js');

    // Get all tickets with their first inbound email body
    const rows = await dbQuery(`
      SELECT DISTINCT ON (q.id) q.id, q.subject, qe.body_text
      FROM queries q
      LEFT JOIN query_emails qe ON qe.query_id = q.id AND qe.direction = 'inbound_customer'
      ORDER BY q.id, qe.received_at ASC
    `);

    const results = [];
    for (const row of rows.rows) {
      const summary = await generateSummary(row.subject, row.body_text || '');
      await dbQuery(`UPDATE queries SET description = $1 WHERE id = $2`, [summary, row.id]);
      results.push({ id: row.id, subject: row.subject, summary });
    }
    res.json({ updated: results.length, results });
  } catch (err) {
    console.error('[regenerate-summaries]', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/disconnect', requireAuth, async (req, res, next) => {
  try { await disconnect(); res.json({ ok: true }); }
  catch (err) { next(err); }
});

export default router;
