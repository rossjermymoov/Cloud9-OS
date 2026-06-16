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

const REQUEST_TIMEOUT_MS = Number(process.env.VOILA_TIMEOUT_MS) || 20000;

async function voilaGet(path, params = {}, { retries = 2 } = {}) {
  if (!voilaConfigured()) throw new Error('Voila API not configured — set VOILA_API_USER / VOILA_API_TOKEN');
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Hard timeout so a stuck Voila request fails fast instead of hanging the
    // whole backfill. AbortSignal.timeout aborts the fetch after N ms.
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: basicAuth(), Accept: 'application/json' },
        signal,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Voila API ${res.status} on ${path}: ${body.slice(0, 200)}`);
      }
      return res.json();
    } catch (err) {
      lastErr = (err.name === 'TimeoutError' || err.name === 'AbortError')
        ? new Error(`Voila API timed out after ${REQUEST_TIMEOUT_MS}ms on ${path}`)
        : err;
      if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/**
 * Fetch all shipments collected within a date window (paginated).
 * start / end: ISO datetime strings, e.g. '2026-06-01T00:00:00'.
 */
// Fetch a single page of shipments (for streaming backfills that insert as they go).
export async function fetchShipmentsPage(start, end, page, perPage = 100) {
  const data = await voilaGet('/shipments.json', { startDateFilter: start, endDateFilter: end, page, per_page: perPage });
  return Array.isArray(data) ? data : (data.shipments || data.data || []);
}

export async function fetchShipmentsByDateRange(start, end, { onPage } = {}) {
  const PAGE = 100;
  let page = 1;
  const all = [];
  let lastFirstId = null;
  while (page <= 2000) {
    const data = await voilaGet('/shipments.json', { startDateFilter: start, endDateFilter: end, page, per_page: PAGE });
    const list = Array.isArray(data) ? data : (data.shipments || data.data || []);
    if (!list.length) break;
    // Guard against an API that ignores the page param and returns the same page.
    const firstId = list[0] && list[0].id;
    if (firstId != null && firstId === lastFirstId) break;
    lastFirstId = firstId;
    all.push(...list);
    if (onPage) onPage({ page, total: all.length });
    page++;
  }
  return all;
}
