/**
 * Cloud9 OS — Inventory Validator
 *
 * GET  /api/inventory/fields?customer_id=…   — discover the fields Helm exposes on
 *                                              inventory (list + item detail), with
 *                                              a sample value, so the UI can offer
 *                                              a real, live list to validate.
 * POST /api/inventory/validate               — interrogate a customer (or all) for
 *                                              a chosen set of fields; runs in the
 *                                              background, returns a run id.
 * GET  /api/inventory/validate/:id           — poll a run's status + result.
 */

import express from 'express';
import { query } from '../db/index.js';
import { helmConfigured, fetchInventoryForClient, fetchInventoryDetail } from '../services/helmClient.js';

const router = express.Router();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── field helpers ────────────────────────────────────────────────────────────
// Flatten an item to depth 2. Scalars become dotted paths; arrays become `path[]`
// (validated as "has at least one entry").
function flatten(obj, prefix = '', out = {}, depth = 0) {
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) out[`${path}[]`] = v;
    else if (v && typeof v === 'object' && depth < 2) flatten(v, path, out, depth + 1);
    else out[path] = v;
  }
  return out;
}
const isEmpty = (v) => {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
};
const deepGet = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const valueAt = (obj, path) => (path.endsWith('[]') ? deepGet(obj, path.slice(0, -2)) : deepGet(obj, path));
const prettyLabel = (p) => p.replace(/\[\]$/, ' (list)').replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
const summarize = (v) => {
  if (Array.isArray(v)) return `[${v.length} item${v.length === 1 ? '' : 's'}]`;
  const s = String(v);
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
};

async function resolveHelmId(customerId) {
  if (customerId) {
    const r = await query('SELECT helm_customer_id FROM customers WHERE id = $1', [customerId]);
    return r.rows[0]?.helm_customer_id || null;
  }
  const r = await query('SELECT helm_customer_id FROM customers WHERE helm_customer_id IS NOT NULL ORDER BY business_name LIMIT 1');
  return r.rows[0]?.helm_customer_id || null;
}

// ── field discovery ──────────────────────────────────────────────────────────
router.get('/fields', async (req, res, next) => {
  try {
    if (!helmConfigured()) return res.status(503).json({ error: 'Helm API not configured' });
    const helmId = await resolveHelmId(req.query.customer_id);
    if (!helmId) return res.status(409).json({ error: 'No customer with a Helm id found — sync customers first.' });

    const list = await fetchInventoryForClient({ helmClientId: helmId, perPage: 25, maxPages: 1, productTypes: [1] });
    const sample = list.slice(0, 5);
    const fields = new Map();
    const note = (path, value, source) => {
      const cur = fields.get(path) || { path, label: prettyLabel(path), source, sampleValue: null, filled: 0, seen: 0, isArray: path.endsWith('[]') };
      cur.seen++;
      if (source === 'detail' && cur.source !== 'detail' && !fields.has(path)) cur.source = 'detail';
      if (!isEmpty(value)) { cur.filled++; if (cur.sampleValue == null) cur.sampleValue = summarize(value); }
      fields.set(path, cur);
    };
    for (const it of sample) {
      const lf = flatten(it);
      for (const [p, v] of Object.entries(lf)) note(p, v, 'list');
      let detail = null;
      try { const d = await fetchInventoryDetail(it.id); detail = d?.data || d; } catch { /* detail optional */ }
      if (detail) {
        const df = flatten(detail);
        for (const [p, v] of Object.entries(df)) note(p, v, (p in lf) ? 'list' : 'detail');
      }
    }
    const out = [...fields.values()].sort((a, b) =>
      a.source === b.source ? a.path.localeCompare(b.path) : (a.source === 'list' ? -1 : 1));
    res.json({ helm_client_id: helmId, sampled: sample.length, fields: out });
  } catch (err) { next(err); }
});

// ── validation run ───────────────────────────────────────────────────────────
router.post('/validate', async (req, res, next) => {
  try {
    if (!helmConfigured()) return res.status(503).json({ error: 'Helm API not configured' });
    const scope = req.body?.scope === 'all' ? 'all' : 'customer';
    const fields = Array.isArray(req.body?.fields) ? req.body.fields.filter(Boolean).slice(0, 60) : [];
    if (!fields.length) return res.status(400).json({ error: 'Select at least one field to validate.' });
    const customerId = scope === 'customer' ? (req.body?.customer_id || null) : null;
    if (scope === 'customer' && !customerId) return res.status(400).json({ error: 'Pick a customer, or choose all customers.' });

    const ins = await query(
      `INSERT INTO inventory_validation_runs (scope, customer_id, fields, status) VALUES ($1,$2,$3,'running') RETURNING id`,
      [scope, customerId, JSON.stringify(fields)]
    );
    const runId = ins.rows[0].id;
    res.status(202).json({ run_id: runId, status: 'running' });
    setImmediate(() => runValidation(runId, scope, customerId, fields).catch(e => console.warn('[inv-validate]', e.message)));
  } catch (err) { next(err); }
});

const ISSUE_CAP = 4000, ITEM_CAP = 25000;

async function runValidation(runId, scope, customerId, fields) {
  try {
    const custRows = (await query(
      `SELECT id, business_name, helm_customer_id FROM customers
       WHERE helm_customer_id IS NOT NULL ${scope === 'customer' ? 'AND id = $1' : ''}
       ORDER BY business_name`,
      scope === 'customer' ? [customerId] : []
    )).rows;

    const byField = Object.fromEntries(fields.map(f => [f, { missing: 0, total: 0 }]));
    const byCustomer = [];
    const issues = [];
    let itemsChecked = 0, issuesFound = 0;

    for (const c of custRows) {
      const list = await fetchInventoryForClient({ helmClientId: c.helm_customer_id, perPage: 100, maxPages: 500, productTypes: [1] });
      const needDetail = list.length ? (() => { const lf = flatten(list[0]); return fields.some(f => !(f in lf)); })() : false;
      let custItems = 0, custIssues = 0, custMissingCells = 0;

      for (const it of list) {
        if (itemsChecked >= ITEM_CAP) break;
        let merged = it;
        if (needDetail) {
          try { const d = await fetchInventoryDetail(it.id); merged = { ...it, ...(d?.data || d || {}) }; } catch { /* keep list-level */ }
          await sleep(25);
        }
        const missing = [];
        for (const f of fields) {
          byField[f].total++;
          if (isEmpty(valueAt(merged, f))) { byField[f].missing++; missing.push(f); custMissingCells++; }
        }
        custItems++; itemsChecked++;
        if (missing.length) {
          custIssues++; issuesFound++;
          if (issues.length < ISSUE_CAP) issues.push({ customer: c.business_name, sku: it.sku || null, name: it.name || null, inventory_id: it.id, missing });
        }
      }
      byCustomer.push({ customer_id: c.id, customer: c.business_name, items: custItems, with_issues: custIssues, complete_pct: custItems ? Math.round(((custItems - custIssues) / custItems) * 100) : null });
      await query('UPDATE inventory_validation_runs SET items_checked = $1, issues_found = $2 WHERE id = $3', [itemsChecked, issuesFound, runId]).catch(() => {});
      if (itemsChecked >= ITEM_CAP) break;
    }

    const result = {
      fields, byField, byCustomer, issues,
      truncated_issues: issues.length >= ISSUE_CAP,
      item_cap_hit: itemsChecked >= ITEM_CAP,
    };
    await query(
      `UPDATE inventory_validation_runs SET status='ok', items_checked=$1, issues_found=$2, result=$3, finished_at=NOW() WHERE id=$4`,
      [itemsChecked, issuesFound, JSON.stringify(result), runId]
    );
  } catch (err) {
    console.warn('[inv-validate] run failed:', err.message);
    await query('UPDATE inventory_validation_runs SET status=\'error\', error=$1, finished_at=NOW() WHERE id=$2', [err.message, runId]).catch(() => {});
  }
}

router.get('/validate/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, scope, customer_id, fields, status, items_checked, issues_found, result, error, started_at, finished_at
       FROM inventory_validation_runs WHERE id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Run not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

export default router;
