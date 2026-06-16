/**
 * Cloud9 OS — Voila API client
 *
 * Voila is the shipping layer and the source of truth for parcels. Used to
 * backfill historical shipments (the live data arrives via tracking webhooks).
 *
 * Env:
 *   VOILA_API_BASE   default https://app.heyvoila.io/api
 *   VOILA_API_USER   Basic-auth user (DC API user)
 *   VOILA_API_TOKEN  Basic-auth token
 */

const BASE  = (process.env.VOILA_API_BASE || 'https://app.heyvoila.io/api').replace(/\/$/, '');
const USER  = process.env.VOILA_API_USER  || '';
const TOKEN = process.env.VOILA_API_TOKEN || '';

export function voilaConfigured() {
  return Boolean(USER && TOKEN);
}

function basicAuth() {
  return 'Basic ' + Buffer.from(`${USER}:${TOKEN}`).toString('base64');
}

async function voilaGet(path, params = {}) {
  if (!voilaConfigured()) throw new Error('Voila API not configured — set VOILA_API_USER / VOILA_API_TOKEN');
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { Authorization: basicAuth(), Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voila API ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Fetch all shipments collected within a date window (paginated).
 * start / end: ISO datetime strings, e.g. '2026-06-01T00:00:00'.
 */
export async function fetchShipmentsByDateRange(start, end, { onPage } = {}) {
  const PAGE = 50;
  let page = 1;
  const all = [];
  while (page <= 1000) {
    const data = await voilaGet('/shipments.json', { startDateFilter: start, endDateFilter: end, page, per_page: PAGE });
    const list = Array.isArray(data) ? data : (data.shipments || data.data || []);
    if (!list.length) break;
    all.push(...list);
    if (onPage) onPage({ page, total: all.length });
    if (list.length < PAGE) break;
    page++;
  }
  return all;
}
