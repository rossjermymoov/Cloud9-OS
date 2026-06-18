/**
 * Cloud9 OS — Picking API
 *
 * GET  /api/picking/status                  — is Helm configured?
 * GET  /api/picking/summary?period=         — headline KPIs for the period
 * GET  /api/picking/daily?period=           — picks + items per day (chart)
 * GET  /api/picking/leaderboard?period=     — per-picker performance (items/hour headline)
 * GET  /api/picking/freshness               — last sync time
 * POST /api/picking/sync?days=30            — pull picks from Helm (background)
 *
 * All performance metrics are computed on COMPLETED picks (status = 1), bucketed
 * by completion date (`pick_date`). Time basis per pick = active handling time
 * (sum of Helm time-tracking durations), falling back to wall-clock elapsed.
 */

import express from 'express';
import { query } from '../db/index.js';
import { helmConfigured } from '../services/helmClient.js';
import { syncPicks } from '../services/pickingService.js';

const router = express.Router();

const p2 = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

// ── Picking day window (editable) ──────────────────────────────────────────
// Hours are 0–23. Default 08:00 first bucket → 17:00 last bucket (end is the
// exclusive close, so end=18 means the final bar is "5 till 6").
const DEFAULT_WINDOW = { start_hour: 8, end_hour: 18 };
async function getDayWindow() {
  try {
    const { rows } = await query(`SELECT value FROM app_settings WHERE key = 'picking_day_window'`);
    const v = rows[0]?.value || {};
    const s = Math.min(23, Math.max(0, parseInt(v.start_hour)));
    const e = Math.min(24, Math.max(1, parseInt(v.end_hour)));
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) return { start_hour: s, end_hour: e };
  } catch { /* table may not exist yet on first boot */ }
  return { ...DEFAULT_WINDOW };
}
// 24h hour → "8 till 9" style label (12h, no am/pm, no leading zeros).
const disp12 = (h) => ((h % 12) === 0 ? 12 : (h % 12));
const hourRangeLabel = (h) => `${disp12(h)} till ${disp12((h + 1) % 24)}`;

// A single custom day, clamped to the last 90 days.
function parseCustomDate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return null;
  const d = new Date(`${s}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const min = new Date(today); min.setDate(today.getDate() - 90);
  if (d > today) return today;
  if (d < min) return min;
  return d;
}

function rangeFor(periodRaw, dateRaw) {
  const custom = parseCustomDate(dateRaw);
  if (custom) return { period: 'custom', from: isoDay(custom), to: isoDay(custom) };
  const period = ['day', 'yesterday', 'week', 'month', 'quarter'].includes(periodRaw) ? periodRaw : 'week';
  const today = new Date();
  let from = new Date(today), to = new Date(today);
  if (period === 'day')           { /* today only */ }
  else if (period === 'yesterday') { from.setDate(today.getDate() - 1); to.setDate(today.getDate() - 1); }
  else if (period === 'week')      { from.setDate(today.getDate() - 6); }
  else if (period === 'month')     { from.setDate(today.getDate() - 29); }
  else if (period === 'quarter')   { from.setDate(today.getDate() - 89); }
  return { period, from: isoDay(from), to: isoDay(to) };
}

// Per-pick time basis (ms) = active handling time (Σ Helm action durations).
// We deliberately do NOT use elapsed_ms (created→completed): a pick can sit
// generated for ages before picking starts, and picks include idle breaks, so
// wall-clock wildly overstates effort. Handling time is the real work time.
const TIME_BASIS = `COALESCE(NULLIF(handling_ms,0), 0)`;
const COMPLETED = `status = 1 AND pick_date IS NOT NULL`;

// Throughput from the timed picks only: timed_items / timed_hours. Because both
// the numerator and denominator come from the SAME set of picks, this can't
// produce the old "all items ÷ a sliver of time" nonsense. Clamped for safety.
function safeItemsPerHour({ timedPicks, timedItems, totalMs }) {
  if (!timedPicks) return null;
  const hours = Number(totalMs) / 3600000;
  if (hours <= 0) return null;
  const rate = Math.round(Number(timedItems) / hours);
  return rate > 0 && rate < 100000 ? rate : null;        // final sanity clamp
}

router.get('/status', (_req, res) => res.json({ configured: helmConfigured() }));

// Read / update the picking day window (hours that the Waves-per-hour chart spans).
router.get('/settings', async (_req, res, next) => {
  try { res.json({ day_window: await getDayWindow() }); } catch (err) { next(err); }
});
router.put('/settings/day-window', async (req, res, next) => {
  try {
    const s = parseInt(req.body?.start_hour), e = parseInt(req.body?.end_hour);
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || s > 23 || e < 1 || e > 24 || e <= s) {
      return res.status(400).json({ error: 'start_hour 0–23 and end_hour 1–24 required, with end after start' });
    }
    await query(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('picking_day_window', $1::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `, [JSON.stringify({ start_hour: s, end_hour: e })]);
    res.json({ day_window: { start_hour: s, end_hour: e } });
  } catch (err) { next(err); }
});

router.get('/summary', async (req, res, next) => {
  try {
    const { period, from, to } = rangeFor(req.query.period, req.query.date);
    const { rows } = await query(`
      SELECT
        COUNT(*)::int                                              AS picks,
        COALESCE(SUM(item_count),0)::int                           AS items,
        COALESCE(SUM(order_count),0)::int                          AS orders,
        COALESCE(SUM(${TIME_BASIS}),0)::bigint                     AS total_ms,
        COUNT(*) FILTER (WHERE ${TIME_BASIS} > 0)::int             AS timed_picks,
        COALESCE(SUM(item_count) FILTER (WHERE ${TIME_BASIS} > 0),0)::int AS timed_items,
        COALESCE(SUM(item_scan_ms),0)::bigint                      AS item_scan_ms,
        COALESCE(SUM(item_scan_count),0)::int                      AS item_scan_count
      FROM picks
      WHERE ${COMPLETED} AND pick_date >= $1 AND pick_date <= $2
    `, [from, to]);
    const r = rows[0];
    res.json({
      period, from, to,
      picks: r.picks,
      items: r.items,
      orders: r.orders,
      avg_items_per_pick: r.picks ? +(r.items / r.picks).toFixed(1) : 0,
      avg_secs_per_pick:  r.timed_picks ? Math.round((Number(r.total_ms) / r.timed_picks) / 1000) : null,
      // A Helm "pick" is a WAVE; a true pick = one ITEM_SCAN. Average time per
      // pick = total item-scan time ÷ number of item scans (scan-based only).
      avg_secs_per_item:  r.item_scan_count ? +((Number(r.item_scan_ms) / r.item_scan_count) / 1000).toFixed(1) : null,
      item_picks:         r.item_scan_count,   // number of individual item-scan picks (the denominator)
      items_per_hour:     safeItemsPerHour({ picks: r.picks, timedPicks: r.timed_picks, timedItems: r.timed_items, totalMs: r.total_ms }),
      timed_picks: r.timed_picks,          // how many picks had usable timing
      timing_complete: r.picks > 0 && r.timed_picks >= r.picks,
    });
  } catch (err) { next(err); }
});

router.get('/daily', async (req, res, next) => {
  try {
    const { period, from, to } = rangeFor(req.query.period, req.query.date);

    // Single day (today / yesterday / a custom date) → break the day into HOURS so
    // you can see throughput across the working day. A range → one bar per day.
    if (from === to) {
      const win = await getDayWindow();
      const { rows } = await query(`
        SELECT EXTRACT(HOUR FROM completed_at AT TIME ZONE 'UTC')::int AS hour,
               COUNT(*)::int AS picks,
               COALESCE(SUM(item_count),0)::int AS items
        FROM picks
        WHERE ${COMPLETED} AND pick_date = $1 AND completed_at IS NOT NULL
        GROUP BY hour ORDER BY hour ASC
      `, [from]);
      const byHour = new Map(rows.map(r => [r.hour, r]));
      // Show the configured working window, but auto-extend to cover any activity
      // that falls outside it so no picks are ever hidden.
      const active = rows.map(r => r.hour);
      const startH = Math.min(win.start_hour, ...(active.length ? active : [win.start_hour]));
      const endH   = Math.max(win.end_hour, ...(active.length ? active.map(h => h + 1) : [win.end_hour]));
      const buckets = [];
      for (let h = startH; h < endH; h++) {
        const r = byHour.get(h);
        buckets.push({ hour: h, label: hourRangeLabel(h), picks: r?.picks || 0, items: r?.items || 0 });
      }
      return res.json({ period, from, to, granularity: 'hour', window: win, buckets, days: buckets });
    }

    const { rows } = await query(`
      SELECT pick_date::text AS date,
             COUNT(*)::int AS picks,
             COALESCE(SUM(item_count),0)::int AS items
      FROM picks
      WHERE ${COMPLETED} AND pick_date >= $1 AND pick_date <= $2
      GROUP BY pick_date ORDER BY pick_date ASC
    `, [from, to]);
    const days = rows.map(r => ({ ...r, label: r.date }));
    res.json({ period, from, to, granularity: 'day', buckets: days, days });
  } catch (err) { next(err); }
});

router.get('/leaderboard', async (req, res, next) => {
  try {
    const { period, from, to } = rangeFor(req.query.period, req.query.date);
    // Per-PERSON, from pick_contributions — time + items split by the real user
    // who performed each scan, not just the pick's assigned name.
    const { rows } = await query(`
      SELECT
        user_id,
        COALESCE(MAX(picker_name), 'Unknown')                         AS picker_name,
        COUNT(DISTINCT helm_pick_id)::int                             AS picks,
        COALESCE(SUM(items),0)::int                                   AS items,
        COALESCE(SUM(handling_ms),0)::bigint                          AS total_ms,
        COUNT(DISTINCT helm_pick_id) FILTER (WHERE handling_ms > 0)::int  AS timed_picks,
        COALESCE(SUM(items) FILTER (WHERE handling_ms > 0),0)::int    AS timed_items,
        COALESCE(SUM(item_scan_ms),0)::bigint                         AS item_scan_ms,
        COALESCE(SUM(item_scan_count),0)::int                         AS item_scan_count
      FROM pick_contributions
      WHERE pick_date >= $1 AND pick_date <= $2
      GROUP BY user_id
    `, [from, to]);

    const ranked = rows.map(r => ({
      picker_id: r.user_id,
      picker_name: r.picker_name,
      picks: r.picks,
      items: r.items,
      hours: +(Number(r.total_ms) / 3600000).toFixed(2),
      items_per_hour: safeItemsPerHour({ timedPicks: r.timed_picks, timedItems: r.timed_items, totalMs: r.total_ms }),
      avg_secs_per_pick: r.timed_picks ? Math.round((Number(r.total_ms) / r.timed_picks) / 1000) : null,
      avg_secs_per_item: r.item_scan_count ? +((Number(r.item_scan_ms) / r.item_scan_count) / 1000).toFixed(1) : null,
      item_picks: r.item_scan_count,
      timed_picks: r.timed_picks,
    })).sort((a, b) =>
      // Real throughput first (desc), then by items as a fallback.
      ((b.items_per_hour ?? -1) - (a.items_per_hour ?? -1)) || (b.items - a.items)
    );

    res.json({ period, from, to, rows: ranked });
  } catch (err) { next(err); }
});

// Per-pick list — the factual view: which picks, who did them, how long they took.
router.get('/picks', async (req, res, next) => {
  try {
    const { period, from, to } = rangeFor(req.query.period, req.query.date);
    const { rows } = await query(`
      SELECT helm_pick_id, pick_number, picker_name, item_count, order_count,
             status_name, pick_type_name, pick_option_name, completed_at,
             handling_ms, elapsed_ms, contributor_count,
             (${TIME_BASIS})::bigint AS time_ms
      FROM picks
      WHERE ${COMPLETED} AND pick_date >= $1 AND pick_date <= $2
      ORDER BY completed_at DESC NULLS LAST
      LIMIT 500
    `, [from, to]);
    res.json({ period, from, to, rows: rows.map(r => ({
      ...r,
      seconds: r.time_ms ? Math.round(Number(r.time_ms) / 1000) : null,
    })) });
  } catch (err) { next(err); }
});

// Inspect raw timing for recent picks — so we can verify how Helm reports time.
// Re-run a pick sync AFTER deploying (raw timing is only stored from then on).
router.get('/inspect', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 3, 1), 20);
    const vals = [];
    let where = `status = 1`;
    if (req.query.picker) { vals.push(`%${req.query.picker}%`); where += ` AND picker_name ILIKE $${vals.length}`; }
    vals.push(limit);
    const { rows } = await query(`
      SELECT helm_pick_id, pick_number, picker_name, item_count, status_name,
             pick_type_name, pick_option_name, ui_pick, is_batch, force_completed,
             handling_ms, elapsed_ms, helm_created_at, completed_at, raw_payload
      FROM picks WHERE ${where} ORDER BY pick_date DESC NULLS LAST, completed_at DESC NULLS LAST
      LIMIT $${vals.length}
    `, vals);
    res.json(rows.map(r => {
      const raw = r.raw_payload || {};
      const tt = raw.time_tracking_data;
      return {
        pick_number: r.pick_number,
        picker_name: r.picker_name,
        item_count: r.item_count,
        flags: { pick_type: r.pick_type_name, pick_option: r.pick_option_name,
                 ui_pick: r.ui_pick, is_batch: r.is_batch, force_completed: r.force_completed },
        derived: { handling_ms: r.handling_ms, elapsed_ms: r.elapsed_ms,
                   helm_created_at: r.helm_created_at, completed_at: r.completed_at },
        time_tracking_count: Array.isArray(tt) ? tt.length : 0,
        time_tracking_data: tt || '(no raw timing stored — re-run a pick sync after deploy)',
      };
    }));
  } catch (err) { next(err); }
});

// Compare pickers by the attributes that determine whether timing is captured —
// reveals what's different about a picker whose picks never show times.
router.get('/compare', async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 60, 1), 365);
    const [summary, options] = await Promise.all([
      query(`
        SELECT picker_id, MAX(picker_name) AS picker_name,
               COUNT(*)::int AS picks,
               COUNT(*) FILTER (WHERE handling_ms > 0)::int AS timed,
               COUNT(*) FILTER (WHERE handling_ms = 0)::int AS untimed,
               COUNT(*) FILTER (WHERE force_completed)::int AS force_completed,
               COUNT(*) FILTER (WHERE ui_pick)::int AS ui_picks,
               COUNT(*) FILTER (WHERE is_batch)::int AS batched
        FROM picks WHERE status = 1 AND picker_id IS NOT NULL AND pick_date >= CURRENT_DATE - ($1::int - 1)
        GROUP BY picker_id ORDER BY picks DESC`, [days]),
      query(`
        SELECT picker_id, MAX(picker_name) AS picker_name,
               COALESCE(pick_type_name,'?') || ' / ' || COALESCE(pick_option_name,'?') AS method,
               COUNT(*)::int AS picks,
               COUNT(*) FILTER (WHERE handling_ms > 0)::int AS timed
        FROM picks WHERE status = 1 AND picker_id IS NOT NULL AND pick_date >= CURRENT_DATE - ($1::int - 1)
        GROUP BY picker_id, method ORDER BY picks DESC`, [days]),
    ]);
    res.json({ days, by_picker: summary.rows, by_method: options.rows });
  } catch (err) { next(err); }
});

// Diagnostic: every picker seen in contributions (last N days) + all known Helm
// users — so we can spot a picker who's missing or showing as a bare "User <id>".
router.get('/pickers', async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
    const [contrib, byPick, users] = await Promise.all([
      query(`
        SELECT user_id, MAX(picker_name) AS picker_name,
               COUNT(DISTINCT helm_pick_id)::int AS picks,
               COALESCE(SUM(items),0)::int AS items,
               COALESCE(SUM(handling_ms),0)::bigint AS total_ms,
               MIN(pick_date)::text AS first_pick, MAX(pick_date)::text AS last_pick
        FROM pick_contributions WHERE pick_date >= CURRENT_DATE - ($1::int - 1)
        GROUP BY user_id ORDER BY items DESC`, [days]),
      // From the picks table directly — every pick's primary picker, by status,
      // so we can see a picker even if no contribution rows were written.
      query(`
        SELECT picker_id, MAX(picker_name) AS picker_name, status_name,
               COUNT(*)::int AS picks,
               COUNT(*) FILTER (WHERE handling_ms = 0)::int AS untimed
        FROM picks WHERE pick_date >= CURRENT_DATE - ($1::int - 1)
        GROUP BY picker_id, status_name ORDER BY picks DESC`, [days]),
      query(`SELECT helm_user_id, name, email, active FROM helm_users ORDER BY name ASC`),
    ]);
    res.json({ days, contributors: contrib.rows, picks_by_picker: byPick.rows, helm_users: users.rows });
  } catch (err) { next(err); }
});

router.get('/freshness', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT status, records, detail, ran_at FROM helm_sync_log WHERE sync_type='picking' ORDER BY ran_at DESC LIMIT 1`
    );
    res.json(rows[0] || null);
  } catch (err) { next(err); }
});

router.post('/sync', async (req, res, next) => {
  try {
    if (!helmConfigured()) return res.status(503).json({ error: 'Helm API not configured' });
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
    res.status(202).json({ status: 'started', days, message: 'Pulling picks in the background. Check GET /api/picking/freshness.' });
    setImmediate(() => syncPicks(days, { pickDelayMs: 60 }));
  } catch (err) { next(err); }
});

export default router;
