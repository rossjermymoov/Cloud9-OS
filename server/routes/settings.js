/**
 * settings.js — Moov OS settings APIs
 *
 * Carrier communication templates (Top-and-Tail header/footer boilerplate that
 * wraps Gemini's dynamic middle analysis on outbound drafts).
 *
 *   GET /api/settings/couriers
 *   PUT /api/settings/couriers/:courier_code/templates
 */

import express from 'express';
import { query } from '../db/index.js';
import { TRUST_CAP, isLockedCategory } from './../services/workflowTrust.js';

const router = express.Router();

// Editable columns: the two routing endpoints + the four boilerplate templates.
const EDITABLE_COLS = [
  'queries_email',
  'claims_email',
  'tracking_samples',
  'tracking_pattern',
  'tracking_example',
  'courier_header_template',
  'courier_footer_template',
  'customer_header_template',
  'customer_footer_template',
];

// GET /api/settings/couriers — list courier routing rules incl. templates.
router.get('/couriers', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT courier_code, courier_name, queries_email, claims_email, is_active,
             tracking_samples, tracking_pattern, tracking_example,
             courier_header_template, courier_footer_template,
             customer_header_template, customer_footer_template
      FROM courier_routing_rules
      ORDER BY courier_code
    `);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// PUT /api/settings/couriers/:courier_code/templates — update the 4 boilerplates.
router.put('/couriers/:courier_code/templates', async (req, res, next) => {
  try {
    const code    = (req.params.courier_code || '').toLowerCase();
    const updates = Object.entries(req.body).filter(([k]) => EDITABLE_COLS.includes(k));
    if (!updates.length) return res.status(400).json({ error: 'No valid fields provided' });

    const set    = updates.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    const values = [code, ...updates.map(([, v]) => (v == null ? null : String(v)))];
    const result = await query(
      `UPDATE courier_routing_rules SET ${set}, updated_at = NOW() WHERE courier_code = $1 RETURNING *`,
      values,
    );
    if (!result.rows.length) return res.status(404).json({ error: `No courier routing rule for '${code}'` });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ─── SLA & Autopilot Switchboard ──────────────────────────────────────────────

// GET /api/settings/sla-configs
router.get('/sla-configs', async (req, res, next) => {
  try {
    const r = await query(`SELECT * FROM sla_configs ORDER BY response_target_minutes ASC`);
    res.json(r.rows);
  } catch (err) { next(err); }
});

// PUT /api/settings/sla-configs/:group
router.put('/sla-configs/:group', async (req, res, next) => {
  try {
    const allowed = ['response_target_minutes', 'warning_buffer_minutes', 'scream_to_google_chat'];
    const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
    if (!updates.length) return res.status(400).json({ error: 'No valid fields' });
    const set    = updates.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    const values = [req.params.group, ...updates.map(([, v]) => v)];
    const r = await query(`UPDATE sla_configs SET ${set}, updated_at = NOW() WHERE workflow_group = $1 RETURNING *`, values);
    if (!r.rows.length) return res.status(404).json({ error: 'SLA config not found' });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// GET /api/settings/workflow-trust — per-category calibration + autopilot state.
router.get('/workflow-trust', async (req, res, next) => {
  try {
    const r = await query(`SELECT * FROM workflow_trust ORDER BY courier_code, intent`);
    const cap = TRUST_CAP;
    res.json(r.rows.map(w => ({
      ...w,
      cap,
      ready: w.consecutive_clean_approvals >= cap,
      locked: isLockedCategory(w.intent, null),
      stage: w.autopilot_enabled ? 'full_autopilot'
           : w.consecutive_clean_approvals >= cap ? 'autopilot_ready' : 'probation',
    })));
  } catch (err) { next(err); }
});

// PUT /api/settings/workflow-trust/:courier/:intent/toggle  { enabled }
router.put('/workflow-trust/:courier/:intent/toggle', async (req, res, next) => {
  try {
    const courier = (req.params.courier || '').toLowerCase();
    const intent  = (req.params.intent || '').toLowerCase();
    const enable  = req.body.enabled === true || req.body.enabled === 'true';

    if (enable && isLockedCategory(intent, null)) {
      return res.status(400).json({ error: 'Claims / complaints cannot run on Autopilot.' });
    }
    if (enable) {
      const r = await query(`SELECT consecutive_clean_approvals FROM workflow_trust WHERE courier_code = $1 AND intent = $2`, [courier, intent]);
      if (!r.rows.length || r.rows[0].consecutive_clean_approvals < TRUST_CAP) {
        return res.status(400).json({ error: `Not calibrated yet — needs ${TRUST_CAP} consecutive clean approvals.` });
      }
    }
    const upd = await query(
      `UPDATE workflow_trust SET autopilot_enabled = $3, updated_at = NOW()
        WHERE courier_code = $1 AND intent = $2 RETURNING *`,
      [courier, intent, enable],
    );
    if (!upd.rows.length) return res.status(404).json({ error: 'Workflow category not found' });
    res.json(upd.rows[0]);
  } catch (err) { next(err); }
});

export default router;
