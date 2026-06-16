/**
 * Cloud9 OS — Customer health score (v1)
 *
 * RAG score (Ross's convention: green good, amber warning, red at-risk) derived
 * from the signals Cloud9 has today:
 *   • dispatch-volume trend  — parcels last 7 days vs the prior 7 days
 *   • inactivity             — days since the customer last dispatched
 *   • returns rate           — returns in last 30 days / parcels in last 30 days
 *
 * Ticket count + sentiment will be added once the Queries module exists.
 * Writes health_score + a plain-English health_score_summary to each customer.
 */

import { query } from '../db/index.js';

const SEV = { green: 0, amber: 1, red: 2 };
const worse = (a, b) => (SEV[b] > SEV[a] ? b : a);
const daysSince = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null);

export function scoreCustomer(s) {
  const parcels7   = Number(s.parcels_7d) || 0;
  const parcelsPrev = Number(s.parcels_prev_7d) || 0;
  const parcels30  = Number(s.parcels_30d) || 0;
  const returns30  = Number(s.returns_30d) || 0;
  const lastDays   = daysSince(s.last_dispatch);
  const onboarded  = daysSince(s.date_onboarded) ?? 0;

  let score = 'green';
  const reasons = [];

  if (parcels30 === 0) {
    if (onboarded <= 14) return { score: 'green', summary: 'Newly onboarded — no dispatches yet.' };
    return { score: 'red', summary: 'No dispatches in the last 30+ days — at risk of churn.' };
  }

  // Inactivity
  if (lastDays != null && lastDays >= 14) { score = worse(score, 'red'); reasons.push(`no dispatch for ${lastDays} days`); }
  else if (lastDays != null && lastDays >= 7) { score = worse(score, 'amber'); reasons.push(`no dispatch for ${lastDays} days`); }

  // Volume trend (week over week)
  if (parcelsPrev > 0) {
    const wow = (parcels7 - parcelsPrev) / parcelsPrev;
    if (wow <= -0.5) { score = worse(score, 'red'); reasons.push(`volume down ${Math.round(-wow * 100)}% week-on-week`); }
    else if (wow <= -0.25) { score = worse(score, 'amber'); reasons.push(`volume down ${Math.round(-wow * 100)}% week-on-week`); }
    else if (wow >= 0.25) { reasons.push(`volume up ${Math.round(wow * 100)}% week-on-week`); }
  }

  // Returns rate
  if (parcels30 > 0 && returns30 > 0) {
    const rate = returns30 / parcels30;
    if (rate > 0.10) { score = worse(score, 'red'); reasons.push(`high returns rate ${(rate * 100).toFixed(1)}%`); }
    else if (rate > 0.05) { score = worse(score, 'amber'); reasons.push(`returns rate ${(rate * 100).toFixed(1)}%`); }
  }

  const summary = reasons.length
    ? reasons.map((r, i) => (i === 0 ? r.charAt(0).toUpperCase() + r.slice(1) : r)).join('; ') + '.'
    : 'Stable volume and low returns.';
  return { score, summary };
}

export async function recomputeHealthAll() {
  const { rows } = await query(`
    SELECT c.id, c.date_onboarded,
           COALESCE(v7.parcels, 0)      AS parcels_7d,
           COALESCE(vprev.parcels, 0)   AS parcels_prev_7d,
           COALESCE(v30.parcels, 0)     AS parcels_30d,
           last.last_dispatch,
           COALESCE(r.returns_30d, 0)   AS returns_30d
    FROM customers c
    LEFT JOIN (SELECT customer_id, SUM(parcel_count) parcels FROM customer_volume_snapshots
               WHERE snapshot_date >= CURRENT_DATE - 6 GROUP BY customer_id) v7 ON v7.customer_id = c.id
    LEFT JOIN (SELECT customer_id, SUM(parcel_count) parcels FROM customer_volume_snapshots
               WHERE snapshot_date BETWEEN CURRENT_DATE - 13 AND CURRENT_DATE - 7 GROUP BY customer_id) vprev ON vprev.customer_id = c.id
    LEFT JOIN (SELECT customer_id, SUM(parcel_count) parcels FROM customer_volume_snapshots
               WHERE snapshot_date >= CURRENT_DATE - 29 GROUP BY customer_id) v30 ON v30.customer_id = c.id
    LEFT JOIN (SELECT customer_id, MAX(snapshot_date) last_dispatch FROM customer_volume_snapshots
               WHERE parcel_count > 0 GROUP BY customer_id) last ON last.customer_id = c.id
    LEFT JOIN (SELECT customer_id, COUNT(*) returns_30d FROM returns
               WHERE created_at >= CURRENT_DATE - 29 GROUP BY customer_id) r ON r.customer_id = c.id
  `);

  let updated = 0;
  for (const row of rows) {
    const { score, summary } = scoreCustomer(row);
    await query(
      `UPDATE customers SET health_score = $1::health_score_status, health_score_summary = $2, health_score_updated = NOW() WHERE id = $3`,
      [score, summary, row.id]
    );
    updated++;
  }
  return updated;
}
