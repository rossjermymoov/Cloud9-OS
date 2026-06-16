/**
 * Cloud9 OS — UK bank holidays + working-day calendar
 *
 * Source: gov.uk's official feed https://www.gov.uk/bank-holidays.json
 * We cache the england-and-wales division in `bank_holidays` and refresh weekly.
 * Working day = Mon–Fri that is NOT a bank holiday. All date maths is done on
 * 'YYYY-MM-DD' strings in UTC-midnight to avoid timezone drift; the London
 * timezone only matters when deciding which calendar day a timestamp falls on
 * (see slaService).
 */

import { query } from '../db/index.js';

const DIVISION = process.env.BANK_HOLIDAY_DIVISION || 'england-and-wales';
const FEED = 'https://www.gov.uk/bank-holidays.json';

let cache = { set: null, loadedAt: 0 };
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // re-read from DB every 6h

export async function syncBankHolidays() {
  const controller = AbortSignal.timeout(15000);
  const res = await fetch(FEED, { signal: controller, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`gov.uk bank-holidays ${res.status}`);
  const data = await res.json();
  const events = data?.[DIVISION]?.events || [];
  let n = 0;
  for (const e of events) {
    if (!e?.date) continue;
    await query(
      `INSERT INTO bank_holidays (division, holiday_date, title)
       VALUES ($1,$2,$3)
       ON CONFLICT (division, holiday_date) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()`,
      [DIVISION, e.date, e.title || null]
    );
    n++;
  }
  cache = { set: null, loadedAt: 0 }; // invalidate
  console.log(`📅 bank holidays synced: ${n} (${DIVISION})`);
  return n;
}

/** Set of 'YYYY-MM-DD' holiday dates, cached in-process. */
export async function holidaySet() {
  if (cache.set && (Date.now() - cache.loadedAt) < CACHE_TTL_MS) return cache.set;
  const { rows } = await query(`SELECT holiday_date::text AS d FROM bank_holidays WHERE division = $1`, [DIVISION]);
  cache = { set: new Set(rows.map(r => r.d)), loadedAt: Date.now() };
  return cache.set;
}

// ─── Working-day helpers (operate on 'YYYY-MM-DD' strings) ───────────────────
export function addDaysStr(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dow(ymd) { return new Date(`${ymd}T00:00:00Z`).getUTCDay(); } // 0 Sun … 6 Sat

export function isWorkingDay(ymd, hs) {
  const w = dow(ymd);
  return w !== 0 && w !== 6 && !hs.has(ymd);
}
export function firstWorkingOnOrAfter(ymd, hs) {
  let d = ymd;
  for (let i = 0; i < 30 && !isWorkingDay(d, hs); i++) d = addDaysStr(d, 1);
  return d;
}
export function firstWorkingAfter(ymd, hs) {
  return firstWorkingOnOrAfter(addDaysStr(ymd, 1), hs);
}
