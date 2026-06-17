/**
 * Moov OS — SLA Targets (Policies) & Triggers (Rules) API
 *
 * Freshdesk-style architecture:
 *   • Policies = named SLA profiles, each holding a per-priority target grid
 *               (response_hours / resolution_hours for urgent|high|medium|low).
 *   • Triggers = IF (field/operator/value) THEN (set priority + link policy) rules,
 *               evaluated on ticket ingest, highest weight first.
 *
 * GET/POST/PATCH/DELETE /api/sla/policies
 * GET/POST/PATCH/DELETE /api/sla/rules
 */

import express from 'express';
import { query } from '../db/index.js';

const router = express.Router();

const PRIORITIES = ['urgent', 'high', 'medium', 'low'];

// Normalise an incoming targets array into clean {priority,response,resolution} rows.
function cleanTargets(targets) {
  if (!Array.isArray(targets)) return [];
  return targets
    .filter(t => PRIORITIES.includes(t.priority))
    .map(t => ({
      priority:         t.priority,
      response_hours:   t.response_hours   === '' || t.response_hours   == null ? null : parseInt(t.response_hours,   10),
      resolution_hours: t.resolution_hours === '' || t.resolution_hours == null ? null : parseInt(t.resolution_hours, 10),
    }));
}

// Replace a policy's full target grid (delete + reinsert the provided priorities).
async function writeTargets(policyId, targets) {
  for (const t of targets) {
    await query(
      `INSERT INTO sla_policy_targets (policy_id, priority, response_hours, resolution_hours)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (policy_id, priority)
       DO UPDATE SET response_hours = EXCLUDED.response_hours,
                     resolution_hours = EXCLUDED.resolution_hours`,
      [policyId, t.priority, t.response_hours, t.resolution_hours]
    );
  }
}

// The single duration_hours kept on sla_policies (legacy auto-assign + inbox view
// fallback) tracks the medium-priority resolution target.
function mediumResolution(targets) {
  const m = targets.find(t => t.priority === 'medium') || targets[0];
  return m?.resolution_hours ?? null;
}

// ─── SLA Policies (Targets) ───────────────────────────────────

// GET /api/sla/policies  → each policy with its targets[] grid attached
router.get('/policies', async (req, res, next) => {
  try {
    const pols    = await query('SELECT * FROM sla_policies ORDER BY priority DESC, name');
    const targets = await query('SELECT * FROM sla_policy_targets');
    const byPolicy = {};
    for (const t of targets.rows) (byPolicy[t.policy_id] ||= []).push(t);
    const rows = pols.rows.map(p => ({
      ...p,
      targets: PRIORITIES.map(pr =>
        byPolicy[p.id]?.find(t => t.priority === pr) || { priority: pr, response_hours: null, resolution_hours: null }
      ),
    }));
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/sla/policies  → { name, description?, courier_code?, query_type?, priority?, targets[] }
router.post('/policies', async (req, res, next) => {
  try {
    const { name, description, courier_code, query_type, priority = 0, targets } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    const grid = cleanTargets(targets);
    const result = await query(
      `INSERT INTO sla_policies (name, description, courier_code, query_type, duration_hours, priority)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name.trim(), description || null, courier_code || null, query_type || null, mediumResolution(grid), +priority]
    );
    const policy = result.rows[0];
    if (grid.length) await writeTargets(policy.id, grid);
    res.status(201).json(policy);
  } catch (err) { next(err); }
});

// PATCH /api/sla/policies/:id  → update fields and/or replace targets grid
router.patch('/policies/:id', async (req, res, next) => {
  try {
    const allowed = ['name', 'description', 'courier_code', 'query_type', 'priority', 'is_active', 'duration_hours'];
    const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
    let policy;

    if (updates.length) {
      const set    = updates.map(([k], i) => `${k} = $${i + 2}`).join(', ');
      const values = [req.params.id, ...updates.map(([, v]) => v)];
      const result = await query(`UPDATE sla_policies SET ${set} WHERE id = $1 RETURNING *`, values);
      if (!result.rows.length) return res.status(404).json({ error: 'Policy not found' });
      policy = result.rows[0];
    }

    if (req.body.targets) {
      const grid = cleanTargets(req.body.targets);
      await writeTargets(req.params.id, grid);
      // keep the legacy duration_hours mirror in sync with the medium target
      const med = mediumResolution(grid);
      if (med != null) await query('UPDATE sla_policies SET duration_hours = $1 WHERE id = $2', [med, req.params.id]);
    }

    if (!policy) {
      const r = await query('SELECT * FROM sla_policies WHERE id = $1', [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Policy not found' });
      policy = r.rows[0];
    }
    res.json(policy);
  } catch (err) { next(err); }
});

// DELETE /api/sla/policies/:id  (targets + dependent rules cascade)
router.delete('/policies/:id', async (req, res, next) => {
  try {
    const result = await query('DELETE FROM sla_policies WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Policy not found' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ─── SLA Rules (Triggers) ─────────────────────────────────────

// GET /api/sla/rules  → IF/THEN triggers with linked policy name, weight-ordered
router.get('/rules', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT r.*, p.name AS policy_name, p.duration_hours AS policy_hours
      FROM sla_rules r
      LEFT JOIN sla_policies p ON p.id = r.policy_id
      ORDER BY r.priority DESC, r.created_at ASC
    `);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/sla/rules
//   IF   { condition_field, operator, match_value }
//   THEN { set_priority?, policy_id? }
//   weight = priority (execution order, higher first)
router.post('/rules', async (req, res, next) => {
  try {
    const { name, condition_field, operator, match_value, set_priority, policy_id, priority = 0 } = req.body;
    if (!name?.trim())          return res.status(400).json({ error: 'name is required' });
    if (!condition_field)       return res.status(400).json({ error: 'condition_field is required' });
    if (!operator)              return res.status(400).json({ error: 'operator is required' });
    if (!match_value?.trim())   return res.status(400).json({ error: 'match_value is required' });
    if (!set_priority && !policy_id)
      return res.status(400).json({ error: 'a trigger must set a priority and/or link a policy' });

    const result = await query(
      `INSERT INTO sla_rules
         (name, condition_field, operator, match_value, set_priority, policy_id, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name.trim(), condition_field, operator, match_value.trim(), set_priority || null, policy_id || null, +priority]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// PATCH /api/sla/rules/:id
router.patch('/rules/:id', async (req, res, next) => {
  try {
    const allowed = ['name', 'condition_field', 'operator', 'match_value', 'set_priority', 'policy_id', 'priority', 'is_active'];
    const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
    if (!updates.length) return res.status(400).json({ error: 'No valid fields' });

    const set    = updates.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    const values = [req.params.id, ...updates.map(([, v]) => v === '' ? null : v)];
    const result = await query(`UPDATE sla_rules SET ${set} WHERE id = $1 RETURNING *`, values);
    if (!result.rows.length) return res.status(404).json({ error: 'Rule not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/sla/rules/:id
router.delete('/rules/:id', async (req, res, next) => {
  try {
    const result = await query('DELETE FROM sla_rules WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Rule not found' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

export default router;
