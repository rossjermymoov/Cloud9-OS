/**
 * Moov OS — Email Settings API
 *
 * GET  /api/email/config            — get provider config (API key masked)
 * PUT  /api/email/config            — save provider config
 * POST /api/email/config/test       — send a test email
 * GET  /api/email/alerts            — list all alert types + recipients
 * PUT  /api/email/alerts/:code      — update alert type (enabled, settings)
 * GET  /api/email/alerts/:code/recipients
 * POST /api/email/alerts/:code/recipients
 * DELETE /api/email/alerts/:code/recipients/:id
 */

import express from 'express';
import { query } from '../db/index.js';
import { testConnection } from '../services/emailService.js';

const router = express.Router();

// ─── Config ───────────────────────────────────────────────────────────────────

router.get('/config', async (req, res, next) => {
  try {
    const result = await query('SELECT id, provider, from_address, from_name, enabled, updated_at, (api_key IS NOT NULL AND api_key != \'\') AS has_api_key FROM email_config WHERE id = 1');
    res.json(result.rows[0] || {});
  } catch (err) { next(err); }
});

router.put('/config', async (req, res, next) => {
  try {
    const { api_key, from_address, from_name, enabled } = req.body;

    // Build SET clause dynamically so a null api_key doesn't wipe an existing one
    const sets = [];
    const vals = [];
    let idx = 1;

    if (api_key !== undefined && api_key !== null) { sets.push(`api_key = $${idx++}`);      vals.push(api_key); }
    if (from_address !== undefined)                { sets.push(`from_address = $${idx++}`); vals.push(from_address); }
    if (from_name !== undefined)                   { sets.push(`from_name = $${idx++}`);    vals.push(from_name); }
    if (enabled !== undefined)                     { sets.push(`enabled = $${idx++}`);      vals.push(enabled); }

    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });

    sets.push(`updated_at = NOW()`);
    vals.push(1); // WHERE id = $N

    const result = await query(
      `UPDATE email_config SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, provider, from_address, from_name, enabled, updated_at, (api_key IS NOT NULL AND api_key != '') AS has_api_key`,
      vals
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

router.post('/config/test', async (req, res, next) => {
  try {
    const { api_key, from_address, from_name, to } = req.body;

    if (!api_key || !from_address || !to) {
      return res.status(400).json({ error: 'api_key, from_address, and to are required' });
    }

    await testConnection(api_key, from_address, from_name, to);
    res.json({ sent: true });
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

// ─── Alert types ──────────────────────────────────────────────────────────────

router.get('/alerts', async (req, res, next) => {
  try {
    const typesRes = await query('SELECT * FROM email_alert_types ORDER BY id');
    const recipRes = await query('SELECT * FROM email_alert_recipients ORDER BY alert_type_id, id');

    const recipByType = {};
    for (const r of recipRes.rows) {
      if (!recipByType[r.alert_type_id]) recipByType[r.alert_type_id] = [];
      recipByType[r.alert_type_id].push(r);
    }

    const alerts = typesRes.rows.map(t => ({
      ...t,
      recipients: recipByType[t.id] || [],
    }));

    res.json(alerts);
  } catch (err) { next(err); }
});

router.put('/alerts/:code', async (req, res, next) => {
  try {
    const { enabled, settings } = req.body;
    const sets = [];
    const vals = [];
    let idx = 1;

    if (enabled !== undefined) { sets.push(`enabled = $${idx++}`);  vals.push(enabled); }
    if (settings !== undefined) { sets.push(`settings = $${idx++}`); vals.push(JSON.stringify(settings)); }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });

    sets.push('updated_at = NOW()');
    vals.push(req.params.code);

    const result = await query(
      `UPDATE email_alert_types SET ${sets.join(', ')} WHERE code = $${idx} RETURNING *`,
      vals
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Alert type not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ─── Recipients ───────────────────────────────────────────────────────────────

router.get('/alerts/:code/recipients', async (req, res, next) => {
  try {
    const typeRes = await query('SELECT id FROM email_alert_types WHERE code = $1', [req.params.code]);
    if (!typeRes.rows.length) return res.status(404).json({ error: 'Alert type not found' });
    const result = await query('SELECT * FROM email_alert_recipients WHERE alert_type_id = $1 ORDER BY id', [typeRes.rows[0].id]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.post('/alerts/:code/recipients', async (req, res, next) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    const typeRes = await query('SELECT id FROM email_alert_types WHERE code = $1', [req.params.code]);
    if (!typeRes.rows.length) return res.status(404).json({ error: 'Alert type not found' });

    const result = await query(
      `INSERT INTO email_alert_recipients (alert_type_id, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (alert_type_id, email) DO UPDATE SET name = EXCLUDED.name, enabled = true
       RETURNING *`,
      [typeRes.rows[0].id, email.toLowerCase().trim(), name || null]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

router.delete('/alerts/:code/recipients/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM email_alert_recipients WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

export default router;
