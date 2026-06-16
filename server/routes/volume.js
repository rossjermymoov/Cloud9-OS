/**
 * Cloud9 OS — Dispatch volume API
 * Reads the customer_volume_snapshots populated by the Helm volume sync.
 *
 * GET /api/volume/summary             — today + 7d + 30d parcels & items
 * GET /api/volume/daily?days=14       — daily totals across all customers
 * GET /api/volume/by-customer?days=1  — per-customer totals for the window
 */

import express from 'express';
import { query } from '../db/index.js';

const router = express.Router();

router.get('/summary', async (_req, res, next) => {
  try {
    const [vol, picks] = await Promise.all([
      query(`
        SELECT
          COALESCE(SUM(parcel_count) FILTER (WHERE snapshot_date = CURRENT_DATE), 0)::int            AS parcels_today,
          COALESCE(SUM(item_count)   FILTER (WHERE snapshot_date = CURRENT_DATE), 0)::int            AS items_today,
          -- same weekday last week (for "vs last <weekday>" comparison)
          COALESCE(SUM(parcel_count) FILTER (WHERE snapshot_date = CURRENT_DATE - 7), 0)::int        AS parcels_last_week,
          COALESCE(SUM(item_count)   FILTER (WHERE snapshot_date = CURRENT_DATE - 7), 0)::int        AS items_last_week,
          COALESCE(SUM(parcel_count) FILTER (WHERE snapshot_date >= CURRENT_DATE - 6), 0)::int       AS parcels_7d,
          COALESCE(SUM(item_count)   FILTER (WHERE snapshot_date >= CURRENT_DATE - 6), 0)::int       AS items_7d
        FROM customer_volume_snapshots
      `),
      query(`
        SELECT
          COUNT(*) FILTER (WHERE picked_at >= CURRENT_DATE)::int        AS picks_today,
          -- yesterday up to the current time-of-day, for a like-for-like compare
          COUNT(*) FILTER (
            WHERE picked_at >= CURRENT_DATE - INTERVAL '1 day'
              AND picked_at <  (CURRENT_DATE - INTERVAL '1 day') + (NOW() - CURRENT_DATE)
          )::int AS picks_yesterday_to_hour,
          COUNT(*) FILTER (WHERE picked_at >= CURRENT_DATE - 6)::int    AS picks_7d
        FROM pick_events
      `),
    ]);
    res.json({ ...vol.rows[0], ...picks.rows[0] });
  } catch (err) { next(err); }
});

// ── This week vs last week, aligned by weekday (Mon–Sun) ──────
router.get('/weekly', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT snapshot_date::text AS date, SUM(parcel_count)::int AS parcels, SUM(item_count)::int AS items
      FROM customer_volume_snapshots
      WHERE snapshot_date >= (date_trunc('week', CURRENT_DATE)::date - 7)
      GROUP BY snapshot_date
    `);
    const map = Object.fromEntries(rows.map(r => [r.date, r]));

    const now = new Date();
    const dow = (now.getDay() + 6) % 7;            // 0 = Monday
    const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(now.getDate() - dow);
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    const this_week = [], last_week = [];
    for (let i = 0; i < 7; i++) {
      const t = new Date(monday); t.setDate(monday.getDate() + i);
      const l = new Date(monday); l.setDate(monday.getDate() - 7 + i);
      const isFuture = t > now;
      this_week.push({ label: LABELS[i], parcels: isFuture ? null : (map[fmt(t)]?.parcels || 0) });
      last_week.push({ label: LABELS[i], parcels: map[fmt(l)]?.parcels || 0 });
    }
    res.json({ this_week, last_week });
  } catch (err) { next(err); }
});

// ── Flexible trend: week-on-week / month-on-month / quarter ───
function ymd(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

router.get('/trend', async (req, res, next) => {
  try {
    const period = ['day', 'yesterday', 'week', 'month', 'quarter'].includes(req.query.period) ? req.query.period : 'week';
    const [snap, picks] = await Promise.all([
      query(`SELECT snapshot_date::text AS d, SUM(parcel_count)::int AS p, SUM(item_count)::int AS i
             FROM customer_volume_snapshots WHERE snapshot_date >= CURRENT_DATE - 220 GROUP BY snapshot_date`),
      query(`SELECT picked_at::date::text AS d, COUNT(*)::int AS k FROM pick_events
             WHERE picked_at >= CURRENT_DATE - 220 GROUP BY picked_at::date`),
    ]);
    const map = {};
    for (const r of snap.rows) map[r.d] = { parcels: r.p, items: r.i, picks: 0 };
    for (const r of picks.rows) (map[r.d] ||= { parcels: 0, items: 0, picks: 0 }).picks = r.k;
    const get = (d) => map[ymd(d)] || { parcels: 0, items: 0, picks: 0 };
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const addDays = (base, n) => { const x = new Date(base); x.setDate(base.getDate() + n); return x; };

    const pack = (mode, labels, current, previous) => {
      const sum = (arr, k) => arr.reduce((a, x) => a + (x ? (x[k] || 0) : 0), 0);
      const elapsedPrev = (k) => previous.reduce((a, x, idx) => a + ((current[idx] != null && x) ? (x[k] || 0) : 0), 0);
      return { period, mode, labels, current, previous,
        totals: {
          current:  { parcels: sum(current, 'parcels'), items: sum(current, 'items'), picks: sum(current, 'picks') },
          previous: { parcels: elapsedPrev('parcels'), items: elapsedPrev('items'), picks: elapsedPrev('picks') },
        } };
    };

    if (period === 'day') {
      // Day-on-day: today vs yesterday (picks compared to the same hour yesterday).
      const ph = await query(`
        SELECT COUNT(*) FILTER (WHERE picked_at >= CURRENT_DATE)::int AS today,
               COUNT(*) FILTER (WHERE picked_at >= CURRENT_DATE - INTERVAL '1 day'
                                  AND picked_at < (CURRENT_DATE - INTERVAL '1 day') + (NOW() - CURRENT_DATE))::int AS yhour
        FROM pick_events`);
      const today = get(now), yest = get(addDays(now, -1));
      const labels = [], series = [];
      for (let k = 13; k >= 0; k--) { const d = addDays(now, -k); const g = get(d); labels.push(`${d.getDate()}/${d.getMonth() + 1}`); series.push({ parcels: g.parcels, items: g.items, picks: g.picks, dow: d.getDay() }); }
      return res.json({ period: 'day', mode: 'bars', labels, series,
        totals: {
          current:  { parcels: today.parcels, items: today.items, picks: ph.rows[0].today },
          previous: { parcels: yest.parcels,  items: yest.items,  picks: ph.rows[0].yhour },
        } });
    }

    if (period === 'yesterday') {
      // Yesterday vs the day before — the daily management-review metric.
      const ph = await query(`
        SELECT COUNT(*) FILTER (WHERE picked_at >= CURRENT_DATE - INTERVAL '1 day' AND picked_at < CURRENT_DATE)::int AS yest,
               COUNT(*) FILTER (WHERE picked_at >= CURRENT_DATE - INTERVAL '2 day' AND picked_at < CURRENT_DATE - INTERVAL '1 day')::int AS dby
        FROM pick_events`);
      const yest = get(addDays(now, -1)), dby = get(addDays(now, -2));
      const labels = [], series = [];
      for (let k = 13; k >= 0; k--) { const d = addDays(now, -k); const g = get(d); labels.push(`${d.getDate()}/${d.getMonth() + 1}`); series.push({ parcels: g.parcels, items: g.items, picks: g.picks, dow: d.getDay() }); }
      return res.json({ period: 'yesterday', mode: 'bars', labels, series,
        totals: {
          current:  { parcels: yest.parcels, items: yest.items, picks: ph.rows[0].yest },
          previous: { parcels: dby.parcels,  items: dby.items,  picks: ph.rows[0].dby },
        } });
    }

    if (period === 'week') {
      const dow = (now.getDay() + 6) % 7; const monday = addDays(now, -dow);
      const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const current = [], previous = [];
      for (let i = 0; i < 7; i++) {
        const cur = addDays(monday, i);
        current.push(cur > now ? null : get(cur));
        previous.push(get(addDays(monday, -7 + i)));
      }
      return res.json(pack('compare', labels, current, previous));
    }

    if (period === 'month') {
      const firstThis = new Date(now.getFullYear(), now.getMonth(), 1);
      const firstLast = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const daysThis = now.getDate();
      const dLast = daysInMonth(firstLast.getFullYear(), firstLast.getMonth());
      const len = Math.max(daysThis, dLast);
      const labels = [], current = [], previous = [];
      for (let i = 0; i < len; i++) {
        labels.push(String(i + 1));
        current.push(i < daysThis ? get(addDays(firstThis, i)) : null);
        previous.push(i < dLast ? get(addDays(firstLast, i)) : null);
      }
      return res.json(pack('compare', labels, current, previous));
    }

    // quarter → last 6 monthly totals (bars) + this-quarter vs last-quarter totals
    const labels = [], series = [];
    let cur = { parcels: 0, items: 0, picks: 0 }, prev = { parcels: 0, items: 0, picks: 0 };
    for (let k = 5; k >= 0; k--) {
      const mDate = new Date(now.getFullYear(), now.getMonth() - k, 1);
      const dim = daysInMonth(mDate.getFullYear(), mDate.getMonth());
      let p = 0, it = 0, pk = 0;
      for (let dd = 0; dd < dim; dd++) { const g = get(addDays(mDate, dd)); p += g.parcels; it += g.items; pk += g.picks; }
      labels.push(mDate.toLocaleString('en-GB', { month: 'short' }));
      series.push({ parcels: p, items: it, picks: pk });
      if (k < 3) { cur.parcels += p; cur.items += it; cur.picks += pk; } else { prev.parcels += p; prev.items += it; prev.picks += pk; }
    }
    return res.json({ period: 'quarter', mode: 'bars', labels, series, totals: { current: cur, previous: prev } });
  } catch (err) { next(err); }
});

// ── Top customers — by volume or growth, for the selected period/metric ──
router.get('/leaderboard', async (req, res, next) => {
  try {
    const limit  = Math.min(Math.max(parseInt(req.query.limit) || 5, 1), 50);
    const period = ['day', 'yesterday', 'week', 'month', 'quarter'].includes(req.query.period) ? req.query.period : 'month';
    const metricCol = req.query.metric === 'items' ? 'item_count' : 'parcel_count';
    const sort   = req.query.sort === 'volume' ? 'volume' : 'growth';

    // current period-to-date vs the same elapsed length in the previous period
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const add = (d, n) => { const x = new Date(d); x.setDate(d.getDate() + n); return x; };
    let curStart, curEnd, prevStart, prevEnd;
    if (period === 'day') {
      curStart = now; curEnd = now; prevStart = add(now, -1); prevEnd = add(now, -1);
    } else if (period === 'yesterday') {
      curStart = add(now, -1); curEnd = add(now, -1); prevStart = add(now, -2); prevEnd = add(now, -2);
    } else if (period === 'week') {
      const dow = (now.getDay() + 6) % 7; const monday = add(now, -dow);
      curStart = monday; curEnd = now; prevStart = add(monday, -7); prevEnd = add(monday, -7 + dow);
    } else if (period === 'month') {
      const ft = new Date(now.getFullYear(), now.getMonth(), 1);
      const fl = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      curStart = ft; curEnd = now; prevStart = fl; prevEnd = add(fl, now.getDate() - 1);
    } else {
      curStart = add(now, -89); curEnd = now; prevStart = add(now, -179); prevEnd = add(now, -90);
    }

    const { rows } = await query(`
      SELECT c.id, c.business_name,
             COALESCE(cur.v, 0)::int  AS current,
             COALESCE(prev.v, 0)::int AS previous
      FROM customers c
      LEFT JOIN (SELECT customer_id, SUM(${metricCol}) v FROM customer_volume_snapshots
                 WHERE snapshot_date BETWEEN $1 AND $2 GROUP BY customer_id) cur  ON cur.customer_id = c.id
      LEFT JOIN (SELECT customer_id, SUM(${metricCol}) v FROM customer_volume_snapshots
                 WHERE snapshot_date BETWEEN $3 AND $4 GROUP BY customer_id) prev ON prev.customer_id = c.id
      WHERE COALESCE(cur.v,0) + COALESCE(prev.v,0) > 0
    `, [ymd(curStart), ymd(curEnd), ymd(prevStart), ymd(prevEnd)]);

    const ranked = rows.map(r => {
      const growth = r.previous > 0 ? Math.round(((r.current - r.previous) / r.previous) * 1000) / 10 : (r.current > 0 ? null : 0);
      return { id: r.id, business_name: r.business_name, current: r.current, previous: r.previous, growth_pct: growth };
    }).sort((a, b) => {
      if (sort === 'volume') return b.current - a.current;
      const av = a.growth_pct == null ? Infinity : a.growth_pct;
      const bv = b.growth_pct == null ? Infinity : b.growth_pct;
      return bv - av;
    }).slice(0, limit);

    res.json({ period, metric: req.query.metric === 'items' ? 'items' : 'parcels', sort, rows: ranked });
  } catch (err) { next(err); }
});

router.get('/picks', async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 14, 1), 180);
    const { rows } = await query(`
      SELECT picked_at::date::text AS date, COUNT(*)::int AS picks
      FROM pick_events
      WHERE picked_at >= CURRENT_DATE - ($1::int - 1)
      GROUP BY picked_at::date ORDER BY picked_at::date ASC
    `, [days]);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/daily', async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 14, 1), 180);
    const { rows } = await query(`
      SELECT snapshot_date::text AS date,
             SUM(parcel_count)::int AS parcels,
             SUM(item_count)::int   AS items
      FROM customer_volume_snapshots
      WHERE snapshot_date >= CURRENT_DATE - ($1::int - 1)
      GROUP BY snapshot_date
      ORDER BY snapshot_date ASC
    `, [days]);
    res.json(rows);
  } catch (err) { next(err); }
});

// Diagnose where a customer's parcels are: GET /api/volume/diagnose?account=Ccell
router.get('/diagnose', async (req, res, next) => {
  try {
    const acct = req.query.account;
    if (!acct) return res.status(400).json({ error: 'account query param required (e.g. ?account=Ccell)' });
    const cust = await query(
      `SELECT id, business_name, helm_accounts_id FROM customers WHERE helm_accounts_id = $1 OR business_name ILIKE $1 LIMIT 1`, [acct]
    );
    const customerId = cust.rows[0]?.id || null;

    const [byDate, totals, unattrib, nullDisp, distinctAccts] = await Promise.all([
      query(`SELECT dispatched_at::text AS date, COUNT(*)::int AS shipments, SUM(parcel_count)::int AS parcels, SUM(item_count)::int AS items
             FROM shipments WHERE (customer_account = $1 OR customer_id = $2) AND cancelled = false
             GROUP BY dispatched_at ORDER BY dispatched_at DESC NULLS LAST LIMIT 15`, [acct, customerId]),
      query(`SELECT COUNT(*)::int AS shipments, COALESCE(SUM(parcel_count),0)::int AS parcels, COALESCE(SUM(item_count),0)::int AS items
             FROM shipments WHERE customer_account = $1 OR customer_id = $2`, [acct, customerId]),
      query(`SELECT COUNT(*)::int AS n FROM shipments WHERE customer_account = $1 AND customer_id IS NULL`, [acct]),
      query(`SELECT COUNT(*)::int AS n FROM shipments WHERE (customer_account = $1 OR customer_id = $2) AND dispatched_at IS NULL`, [acct, customerId]),
      query(`SELECT customer_account, COUNT(*)::int AS shipments FROM shipments WHERE customer_account ILIKE '%' || $1 || '%' GROUP BY customer_account ORDER BY shipments DESC LIMIT 10`, [acct]),
    ]);

    res.json({
      customer: cust.rows[0] || null,
      resolved_customer_id: customerId,
      total: totals.rows[0],
      unattributed_shipments: unattrib.rows[0].n,
      shipments_missing_dispatch_date: nullDisp.rows[0].n,
      by_dispatch_date: byDate.rows,
      distinct_account_strings: distinctAccts.rows,
    });
  } catch (err) { next(err); }
});

// Daily volume for a single customer over an arbitrary date range.
router.get('/customer/:id', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const vals = [req.params.id];
    let where = 'customer_id = $1';
    if (from) { vals.push(from); where += ` AND snapshot_date >= $${vals.length}`; }
    if (to)   { vals.push(to);   where += ` AND snapshot_date <= $${vals.length}`; }
    const { rows } = await query(`
      SELECT snapshot_date::text AS date, parcel_count::int AS parcels, item_count::int AS items
      FROM customer_volume_snapshots WHERE ${where} ORDER BY snapshot_date ASC
    `, vals);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/by-customer', async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 1, 1), 365);
    const { rows } = await query(`
      SELECT c.id, c.business_name, c.account_number,
             COALESCE(SUM(v.parcel_count), 0)::int AS parcels,
             COALESCE(SUM(v.item_count), 0)::int   AS items
      FROM customers c
      LEFT JOIN customer_volume_snapshots v
        ON v.customer_id = c.id AND v.snapshot_date >= CURRENT_DATE - ($1::int - 1)
      GROUP BY c.id, c.business_name, c.account_number
      HAVING COALESCE(SUM(v.parcel_count), 0) > 0
      ORDER BY parcels DESC
    `, [days]);
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
