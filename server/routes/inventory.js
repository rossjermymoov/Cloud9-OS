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
import { getSetting, setSetting } from '../services/appSettings.js';

const router = express.Router();
const FIELDS_CACHE_KEY = 'inventory_fields';
const ITEM_CAP = 100000;
const ISSUE_CAP = 5000;
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
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    // The field schema doesn't change, so serve the cached list unless a refresh
    // is explicitly requested — no Helm call on a normal page load.
    if (!refresh) {
      const cached = await getSetting(FIELDS_CACHE_KEY, null);
      if (cached && Array.isArray(cached.fields) && cached.fields.length) {
        return res.json({ ...cached, cached: true });
      }
    }
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
    const payload = { sampled: sample.length, generated_at: new Date().toISOString(), fields: out };
    await setSetting(FIELDS_CACHE_KEY, payload).catch(() => {});
    res.json({ ...payload, cached: false });
  } catch (err) { next(err); }
});

// ── Dimensional Sanity Inspection Helpers ─────────────────────────────────────
function extractDims(it) {
  // Check direct properties or nested package_configurations / package_details
  const pkg = Array.isArray(it.package_configurations) && it.package_configurations[0]
    ? it.package_configurations[0]
    : (it.package_configuration || it.package || {});

  const l = parseFloat(it.length ?? it.product_length ?? pkg.length ?? pkg.product_length ?? 0);
  const w = parseFloat(it.width ?? it.product_width ?? pkg.width ?? pkg.product_width ?? 0);
  const h = parseFloat(it.height ?? it.product_height ?? pkg.height ?? pkg.product_height ?? 0);
  // Weight in grams or kg
  let wt = parseFloat(it.weight ?? it.product_weight ?? pkg.weight ?? pkg.product_weight ?? 0);
  const unit = String(it.weight_unit || pkg.weight_unit || 'kg').toLowerCase();
  if (unit === 'kg') wt = wt * 1000; // normalize to grams

  return {
    length: isNaN(l) ? 0 : l,
    width: isNaN(w) ? 0 : w,
    height: isNaN(h) ? 0 : h,
    weight_g: isNaN(wt) ? 0 : wt,
    raw_weight: parseFloat(it.weight ?? pkg.weight ?? 0) || 0,
  };
}

function getProductFamily(name) {
  if (!name) return 'generic';
  return name
    .toLowerCase()
    .replace(/\b(xxs|xs|small|medium|large|xl|xxl|xxxl|[0-9]+(ml|cl|l|g|kg|cm|mm|m|oz|pack|pk|pcs|piece|pieces|pack of \d+))\b/gi, '')
    .replace(/[-–—_():/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inspectDimensionalSanity(item, familyMedian = null) {
  const flags = [];
  const { length, width, height, weight_g, raw_weight } = extractDims(item);

  // If completely unmeasured (all 0), skip sanity checks (missing data checks catch this)
  if (length === 0 && width === 0 && height === 0 && weight_g === 0) {
    return flags;
  }

  // 1. 2D / Flatline Hazard: 2 sides have measurement but 1 side or weight is 0 / microscopic (< 0.1cm)
  const sides = [length, width, height].filter(s => s > 0);
  if (sides.length > 0 && sides.length < 3) {
    flags.push({
      type: 'flatline_zero',
      severity: 'warning',
      title: 'Zero / Flatline Dimension',
      desc: `Missing ${length === 0 ? 'Length' : width === 0 ? 'Width' : 'Height'} (recorded as ${length}×${width}×${height}cm)`,
    });
  }

  // 2. Extreme Aspect Ratio / Unit of Measurement Mismatch (e.g. 500cm length with 10cm width = 50x)
  if (sides.length >= 2) {
    const minSide = Math.min(...sides);
    const maxSide = Math.max(...sides);
    if (minSide > 0 && (maxSide / minSide) > 25) {
      flags.push({
        type: 'unit_mismatch',
        severity: 'warning',
        title: 'Extreme Aspect Ratio / Unit Mismatch?',
        desc: `Ratio of ${maxSide}cm to ${minSide}cm is ${(maxSide / minSide).toFixed(1)}× (possible mm vs cm confusion)`,
      });
    }
  }

  // 3. Volumetric Density Anomaly (Heavy Feather or Styrofoam Brick)
  const vol_cm3 = length * width * height;
  if (vol_cm3 > 10 && weight_g > 0) {
    const density = weight_g / vol_cm3; // g/cm³
    if (density < 0.005) {
      flags.push({
        type: 'density_anomaly',
        severity: 'warning',
        title: 'Abnormally Low Density',
        desc: `Box volume is ${(vol_cm3 / 1000).toFixed(1)}L but weighs only ${(weight_g < 1000 ? weight_g + 'g' : (weight_g/1000).toFixed(2) + 'kg')}`,
      });
    } else if (density > 8.0) {
      flags.push({
        type: 'density_anomaly',
        severity: 'warning',
        title: 'Abnormally Heavy Density',
        desc: `Dense weight ${(weight_g/1000).toFixed(1)}kg in small volume ${(vol_cm3/1000).toFixed(2)}L (${density.toFixed(1)} g/cm³)`,
      });
    }
  }

  // 4. Sibling / Variant Outlier (Compared against cluster median)
  if (familyMedian && familyMedian.count >= 2) {
    if (familyMedian.median_weight > 0 && weight_g > 0) {
      const wtRatio = weight_g / familyMedian.median_weight;
      if (wtRatio > 3.5 || wtRatio < 0.25) {
        flags.push({
          type: 'variant_outlier',
          severity: 'warning',
          title: 'Variant Weight Discrepancy',
          desc: `Weighs ${(weight_g/1000).toFixed(2)}kg vs family median ${(familyMedian.median_weight/1000).toFixed(2)}kg (${wtRatio.toFixed(1)}×)`,
        });
      }
    }
    if (familyMedian.median_vol > 0 && vol_cm3 > 0) {
      const volRatio = vol_cm3 / familyMedian.median_vol;
      if (volRatio > 4.0 || volRatio < 0.2) {
        flags.push({
          type: 'variant_outlier',
          severity: 'warning',
          title: 'Variant Volume Discrepancy',
          desc: `Volume ${(vol_cm3/1000).toFixed(1)}L vs family median ${(familyMedian.median_vol/1000).toFixed(1)}L (${volRatio.toFixed(1)}×)`,
        });
      }
    }
  }

  return flags;
}

// ── validation run ───────────────────────────────────────────────────────────
router.post('/validate', async (req, res, next) => {
  try {
    if (!helmConfigured()) return res.status(503).json({ error: 'Helm API not configured' });
    const scope = req.body?.scope === 'all' ? 'all' : 'customer';
    const fields = Array.isArray(req.body?.fields) ? req.body.fields.filter(Boolean).slice(0, 60) : [];
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

const activeValidationRuns = new Map(); // runId -> { customer_index, total_customers, current_customer, percent, items_checked, issues_found }

async function runValidation(runId, scope, customerId, fields) {
  try {
    const custRows = (await query(
      `SELECT id, business_name, helm_customer_id FROM customers
       WHERE helm_customer_id IS NOT NULL ${scope === 'customer' ? 'AND id = $1' : ''}
       ORDER BY business_name`,
      scope === 'customer' ? [customerId] : []
    )).rows;

    const totalCustomers = custRows.length;
    activeValidationRuns.set(runId, {
      customer_index: 0,
      total_customers: totalCustomers,
      current_customer: totalCustomers > 0 ? custRows[0].business_name : 'Starting...',
      items_checked: 0,
      issues_found: 0,
      percent: 0,
    });

    // Preload dismissed alerts
    const dismissedRows = (await query(`SELECT customer_id, sku, alert_type FROM inventory_dismissed_alerts`)).rows;
    const dismissedSet = new Set(dismissedRows.map(r => `${r.customer_id || 'all'}::${r.sku}::${r.alert_type}`));

    const byField = Object.fromEntries(fields.map(f => [f, { missing: 0, total: 0 }]));
    const byCustomer = [];
    const issues = [];
    const sanityAlerts = [];
    let itemsChecked = 0, issuesFound = 0, sanityAlertsFound = 0;

    for (let cIdx = 0; cIdx < custRows.length; cIdx++) {
      const c = custRows[cIdx];
      
      // Update real-time progress state
      activeValidationRuns.set(runId, {
        customer_index: cIdx + 1,
        total_customers: totalCustomers,
        current_customer: c.business_name,
        items_checked: itemsChecked,
        issues_found: issuesFound + sanityAlertsFound,
        percent: Math.min(99, Math.round((cIdx / totalCustomers) * 100)),
      });

      const list = await fetchInventoryForClient({ helmClientId: c.helm_customer_id, perPage: 100, maxPages: 500, productTypes: [1] });
      const needDetail = list.length ? (() => { const lf = flatten(list[0]); return fields.some(f => !(f in lf)); })() : false;
      let custItems = 0, custIssues = 0, custMissingCells = 0, custSanityAlerts = 0;

      // Build product families for sibling outlier detection
      const familyStats = new Map();
      for (const it of list) {
        const fam = getProductFamily(it.name || it.sku);
        const { length, width, height, weight_g } = extractDims(it);
        const vol = length * width * height;
        const entry = familyStats.get(fam) || { weights: [], volumes: [] };
        if (weight_g > 0) entry.weights.push(weight_g);
        if (vol > 0) entry.volumes.push(vol);
        familyStats.set(fam, entry);
      }

      const familyMedians = new Map();
      for (const [fam, data] of familyStats.entries()) {
        const sortedW = [...data.weights].sort((a, b) => a - b);
        const sortedV = [...data.volumes].sort((a, b) => a - b);
        familyMedians.set(fam, {
          count: Math.max(sortedW.length, sortedV.length),
          median_weight: sortedW.length ? sortedW[Math.floor(sortedW.length / 2)] : 0,
          median_vol: sortedV.length ? sortedV[Math.floor(sortedV.length / 2)] : 0,
        });
      }

      for (const it of list) {
        if (itemsChecked >= ITEM_CAP) break;
        let merged = it;
        if (needDetail) {
          try { const d = await fetchInventoryDetail(it.id); merged = { ...it, ...(d?.data || d || {}) }; } catch { /* keep list-level */ }
          await sleep(80); // gentle pacing to respect rate limits
        }

        // 1. Missing field checks
        const missing = [];
        for (const f of fields) {
          byField[f].total++;
          if (isEmpty(valueAt(merged, f))) { byField[f].missing++; missing.push(f); custMissingCells++; }
        }

        // 2. Dimensional sanity checks
        const fam = getProductFamily(it.name || it.sku);
        const rawFlags = inspectDimensionalSanity(merged, familyMedians.get(fam));
        const activeFlags = rawFlags.filter(fl => !dismissedSet.has(`${c.id}::${it.sku}::${fl.type}`) && !dismissedSet.has(`all::${it.sku}::${fl.type}`));

        custItems++; itemsChecked++;

        if (missing.length) {
          custIssues++; issuesFound++;
          if (issues.length < ISSUE_CAP) issues.push({ customer: c.business_name, customer_id: c.id, sku: it.sku || null, name: it.name || null, inventory_id: it.id, missing });
        }

        if (activeFlags.length) {
          custSanityAlerts += activeFlags.length;
          sanityAlertsFound += activeFlags.length;
          if (sanityAlerts.length < ISSUE_CAP) {
            const dims = extractDims(merged);
            sanityAlerts.push({
              customer: c.business_name,
              customer_id: c.id,
              sku: it.sku || '—',
              name: it.name || '—',
              inventory_id: it.id,
              dimensions: `${dims.length} × ${dims.width} × ${dims.height} cm`,
              weight: dims.raw_weight ? `${dims.raw_weight} kg` : '—',
              flags: activeFlags,
            });
          }
        }
      }

      byCustomer.push({
        customer_id: c.id,
        customer: c.business_name,
        items: custItems,
        with_issues: custIssues,
        sanity_alerts: custSanityAlerts,
        complete_pct: custItems ? Math.round(((custItems - custIssues) / custItems) * 100) : null,
      });

      await query('UPDATE inventory_validation_runs SET items_checked = $1, issues_found = $2 WHERE id = $3', [itemsChecked, issuesFound + sanityAlertsFound, runId]).catch(() => {});
      
      // Update progress with latest item counts
      activeValidationRuns.set(runId, {
        customer_index: cIdx + 1,
        total_customers: totalCustomers,
        current_customer: c.business_name,
        items_checked: itemsChecked,
        issues_found: issuesFound + sanityAlertsFound,
        percent: Math.min(99, Math.round(((cIdx + 1) / totalCustomers) * 100)),
      });

      if (itemsChecked >= ITEM_CAP) break;
      await sleep(150); // polite inter-customer throttle
    }

    const result = {
      fields, byField, byCustomer, issues, sanityAlerts,
      sanity_alerts_count: sanityAlertsFound,
      truncated_issues: issues.length >= ISSUE_CAP || sanityAlerts.length >= ISSUE_CAP,
      item_cap_hit: itemsChecked >= ITEM_CAP,
    };

    activeValidationRuns.delete(runId);

    await query(
      `UPDATE inventory_validation_runs SET status='ok', items_checked=$1, issues_found=$2, result=$3, finished_at=NOW() WHERE id=$4`,
      [itemsChecked, issuesFound + sanityAlertsFound, JSON.stringify(result), runId]
    );
  } catch (err) {
    console.warn('[inv-validate] run failed:', err.message);
    activeValidationRuns.delete(runId);
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
    const run = rows[0];
    const live = activeValidationRuns.get(req.params.id);
    res.json({
      ...run,
      current_customer: live?.current_customer || null,
      customer_index: live?.customer_index || null,
      total_customers: live?.total_customers || null,
      percent: live ? live.percent : (run.status === 'ok' ? 100 : 0),
    });
  } catch (err) { next(err); }
});

// ── Dismiss Alerts ───────────────────────────────────────────────────────────
router.get('/dismissed-alerts', async (req, res, next) => {
  try {
    const { customer_id } = req.query;
    const { rows } = await query(
      `SELECT * FROM inventory_dismissed_alerts ${customer_id ? 'WHERE customer_id = $1' : ''} ORDER BY created_at DESC`,
      customer_id ? [customer_id] : []
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/dismiss-alert', async (req, res, next) => {
  try {
    const { customer_id, sku, alert_type, reason, dismissed_by } = req.body || {};
    if (!sku || !alert_type) return res.status(400).json({ error: 'sku and alert_type are required' });

    await query(
      `INSERT INTO inventory_dismissed_alerts (customer_id, sku, alert_type, reason, dismissed_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid), sku, alert_type)
       DO UPDATE SET reason = EXCLUDED.reason, dismissed_by = EXCLUDED.dismissed_by, created_at = NOW()`,
      [customer_id || null, sku, alert_type, reason || 'Manually accepted/dismissed by user', dismissed_by || 'User']
    );
    res.json({ ok: true, sku, alert_type });
  } catch (err) { next(err); }
});

router.post('/undismiss-alert', async (req, res, next) => {
  try {
    const { customer_id, sku, alert_type } = req.body || {};
    if (!sku || !alert_type) return res.status(400).json({ error: 'sku and alert_type are required' });

    await query(
      `DELETE FROM inventory_dismissed_alerts
       WHERE sku = $1 AND alert_type = $2 AND (customer_id = $3 OR ($3 IS NULL AND customer_id IS NULL))`,
      [sku, alert_type, customer_id || null]
    );
    res.json({ ok: true, sku, alert_type });
  } catch (err) { next(err); }
});

export default router;
