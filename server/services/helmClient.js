/**
 * Cloud9 OS — Helm WMS API client
 *
 * Helm public API: https://{company}.myhelm.app/public-api
 * Auth: POST /auth/login { email, password, 2fa_code } -> { token }, then
 *       Bearer token on every request. Token is cached and refreshed on 401.
 *
 * Env:
 *   HELM_API_BASE   e.g. https://saas-ecommerce.myhelm.app/public-api
 *   HELM_EMAIL      login email
 *   HELM_PASSWORD   login password   (keep in server/.env only — never commit)
 *   HELM_2FA_CODE   optional 2FA code
 *
 * Cloud9 "customer" == Helm **fulfilment_client** (the businesses we fulfil for
 * and bill via Xero — they carry billing_email + accounts_id). Helm's own
 * /customers endpoint is end-consumer shipping contacts and is NOT used here.
 */

import { getSetting } from './appSettings.js';

let cachedToken = null;
let lastUsedConfigHash = '';

export async function getHelmConfig() {
  const dbConfig = await getSetting('helm_integration', null);
  if (dbConfig && dbConfig.base_url && dbConfig.email && dbConfig.password) {
    return {
      baseUrl: (dbConfig.base_url || '').replace(/\/$/, ''),
      email: dbConfig.email || '',
      password: dbConfig.password || '',
      twoFaCode: dbConfig.two_fa_code || '',
      source: 'database',
    };
  }
  return {
    baseUrl: (process.env.HELM_API_BASE || '').replace(/\/$/, ''),
    email: process.env.HELM_EMAIL || '',
    password: process.env.HELM_PASSWORD || '',
    twoFaCode: process.env.HELM_2FA_CODE || '',
    source: 'env',
  };
}

export async function helmConfigured() {
  const cfg = await getHelmConfig();
  return Boolean(cfg.baseUrl && cfg.email && cfg.password);
}

export function clearHelmTokenCache() {
  cachedToken = null;
  lastUsedConfigHash = '';
}

// ─── Test Credentials (dry-run without saving) ────────────────────────────────
export async function testHelmCredentials({ baseUrl, email, password, twoFaCode = '' }) {
  const cleanBase = String(baseUrl || '').trim().replace(/\/$/, '');
  if (!cleanBase || !email || !password) {
    throw new Error('Base URL, email, and password are required');
  }
  const res = await fetch(`${cleanBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: email.trim(), password, '2fa_code': twoFaCode }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Helm authentication failed (${res.status}): ${body.slice(0, 180)}`);
  }
  const data = await res.json();
  if (!data.token) throw new Error('Helm responded without an authentication token');
  return { ok: true, token: data.token };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function login() {
  const cfg = await getHelmConfig();
  if (!cfg.baseUrl || !cfg.email || !cfg.password) {
    throw new Error('Helm API not configured — enter credentials in Settings > Helm Integration or set HELM_API_BASE in .env');
  }
  const res = await fetch(`${cfg.baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: cfg.email, password: cfg.password, '2fa_code': cfg.twoFaCode }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Helm login failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.token) throw new Error('Helm login returned no token');
  cachedToken = data.token;
  lastUsedConfigHash = `${cfg.baseUrl}:${cfg.email}`;
  return cachedToken;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function token() {
  return cachedToken || login();
}

// ─── Authenticated GET (auto re-login once on 401 & auto-backoff on 429) ──────
export async function authedGet(pathOrUrl, params = {}) {
  const cfg = await getHelmConfig();
  const url = pathOrUrl.startsWith('http')
    ? new URL(pathOrUrl)
    : new URL(`${cfg.baseUrl}${pathOrUrl}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let t = await token();
    let res = await fetch(url, { headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' } });

    if (res.status === 401) {
      cachedToken = null;
      t = await login();
      res = await fetch(url, { headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' } });
    }

    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('Retry-After');
      const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;
      const backoffMs = retryAfterSeconds && !isNaN(retryAfterSeconds)
        ? (retryAfterSeconds + 0.5) * 1000
        : Math.min(2000 * Math.pow(1.6, attempt - 1), 12000);

      console.warn(`[helmClient] Rate limited (429) on ${url.pathname}. Backing off for ${Math.round(backoffMs)}ms before retry (attempt ${attempt}/${maxAttempts})...`);
      await sleep(backoffMs);
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Helm API ${res.status} on ${url.pathname}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  throw new Error(`Helm API rate limit exceeded on ${url.pathname} after ${maxAttempts} retries`);
}

// ─── Authenticated Mutation (PUT / PATCH / POST with 429 backoff) ─────────────
export async function authedMutate(method, pathOrUrl, body = {}, params = {}) {
  const cfg = await getHelmConfig();
  const url = pathOrUrl.startsWith('http')
    ? new URL(pathOrUrl)
    : new URL(`${cfg.baseUrl}${pathOrUrl}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let t = await token();
    const headers = { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', Accept: 'application/json' };
    let res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      cachedToken = null;
      t = await login();
      headers.Authorization = `Bearer ${t}`;
      res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    }

    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('Retry-After');
      const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;
      const backoffMs = retryAfterSeconds && !isNaN(retryAfterSeconds)
        ? (retryAfterSeconds + 0.5) * 1000
        : Math.min(2000 * Math.pow(1.6, attempt - 1), 12000);

      console.warn(`[helmClient] Rate limited (429) on ${method} ${url.pathname}. Backing off for ${Math.round(backoffMs)}ms before retry (attempt ${attempt}/${maxAttempts})...`);
      await sleep(backoffMs);
      continue;
    }

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Helm API ${res.status} on ${method} ${url.pathname}: ${text.slice(0, 300)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return { ok: true, raw: text };
    }
  }

  throw new Error(`Helm API rate limit exceeded on ${method} ${url.pathname} after ${maxAttempts} retries`);
}

// Walk Helm's pagination ({ data, current_page, last_page, next_page_url }).
async function fetchAllPages(path, { params = {}, max = 100 } = {}) {
  const all = [];
  let page = 1;
  for (let i = 0; i < max; i++) {
    const res = await authedGet(path, { ...params, page });
    const rows = res.data || [];
    all.push(...rows);
    const lastPage = parseInt(res.last_page) || 1;
    if (!res.next_page_url || page >= lastPage || rows.length === 0) break;
    page++;
    await sleep(80); // gentle pacing
  }
  return all;
}

// ─── Connectivity check ──────────────────────────────────────────────────────
export async function verify() {
  const me = await authedGet('/auth/verify');
  return me; // { id, email }
}

// ─── Fulfilment clients == Cloud9 customers ──────────────────────────────────
export function mapFulfilmentClient(fc) {
  return {
    helm_customer_id: fc.id != null ? String(fc.id) : null,
    business_name:    fc.name || '',
    primary_email:    fc.contact_email || null,
    accounts_email:   fc.billing_email || fc.contact_email || null,
    phone_number:     fc.phone || null,
    helm_accounts_id: fc.accounts_id != null ? String(fc.accounts_id) : null, // -> Xero contact link
    account_status:   fc.status === 1 ? 'active' : 'suspended',
    _raw:             fc,
  };
}

export async function fetchFulfilmentClients() {
  const list = await fetchAllPages('/fulfilment_clients');
  return list.map(mapFulfilmentClient);
}

// Raw, unmapped fulfilment-client response (for inspecting Helm's real fields).
export async function rawFulfilmentClients(page = 1) {
  return authedGet('/fulfilment_clients', { page });
}

// ─── Purchase orders (pull side — webhooks are the primary path) ─────────────
export async function fetchPurchaseOrders() {
  return fetchAllPages('/purchase_orders');
}

export async function fetchPurchaseOrder(id) {
  return authedGet(`/purchase_order/${id}`);
}

export async function fetchPurchaseOrderDeliveries() {
  return fetchAllPages('/purchase_order_deliveries');
}

// ─── Dispatch volume (parcels + items per day, per fulfilment client) ────────
//
// We attribute orders to a Cloud9 customer using the `fulfilment_clients` filter
// because the order body does not expose fulfilment_client_id directly. Dispatch
// statuses: 5 = Despatched, 81 = Partially Shipped.

const DISPATCHED_STATUSES = [5, 81];

function ukDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${dt.getFullYear()}`;
}

/**
 * Fetch all despatched orders for one fulfilment client within a dispatch-date
 * window. `from`/`to` may be Date objects or 'YYYY-MM-DD' strings.
 */
export async function fetchDispatchedOrders({ helmClientId, from, to, maxPages = 200 }) {
  const all = [];
  let page = 1;
  for (let i = 0; i < maxPages; i++) {
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', '100');
    qs.set('sort', 'datedispatched_rp');
    for (const s of DISPATCHED_STATUSES) qs.append('filters[status][]', String(s));
    qs.set('filters[dispatched_date_range]', `${ukDate(from)},${ukDate(to)}`);
    if (helmClientId != null) qs.append('filters[fulfilment_clients][]', String(helmClientId));

    const res = await authedGet(`/orders?${qs.toString()}`);
    const rows = res.data || [];
    all.push(...rows);
    const lastPage = parseInt(res.last_page) || 1;
    if (!res.next_page_url || page >= lastPage || rows.length === 0) break;
    page++;
  }
  return all;
}

/**
 * Fetch ALL orders for one fulfilment client received within a date window
 * (any status — needed for the on-time SLA so we see undispatched/overdue too).
 * Helm filters by `date_received` via filters[date_range] in UK DD/MM/YYYY.
 */
export async function fetchOrdersForClient({ helmClientId, from, to, maxPages = 200 }) {
  const all = [];
  let page = 1;
  for (let i = 0; i < maxPages; i++) {
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', '100');
    qs.set('sort', 'datereceived_rp');
    qs.set('filters[date_range]', `${ukDate(from)},${ukDate(to)}`);
    if (helmClientId != null) qs.append('filters[fulfilment_clients][]', String(helmClientId));

    const res = await authedGet(`/orders?${qs.toString()}`);
    const rows = res.data || [];
    all.push(...rows);
    const lastPage = parseInt(res.last_page) || 1;
    if (!res.next_page_url || page >= lastPage || rows.length === 0) break;
    page++;
  }
  return all;
}

/**
 * Fetch ALL orders updated within a date window (any client, any status), so we
 * can keep live pipeline statuses (Picking/Packing/Despatch Ready) fresh. Orders
 * carry fulfilment_client_id for attribution, so no per-client loop is needed.
 */
export async function fetchOrdersUpdatedRange({ from, to, maxPages = 400 }) {
  const all = [];
  let page = 1;
  for (let i = 0; i < maxPages; i++) {
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', '100');
    qs.set('sort', 'datereceived_rp');
    qs.set('filters[last_updated_date_range]', `${ukDate(from)},${ukDate(to)}`);
    const res = await authedGet(`/orders?${qs.toString()}`);
    const rows = res.data || [];
    all.push(...rows);
    const lastPage = parseInt(res.last_page) || 1;
    if (!res.next_page_url || page >= lastPage || rows.length === 0) break;
    page++;
  }
  return all;
}

/**
 * Fetch ALL orders currently in the given statuses (no date window), so we can
 * count the live pipeline exactly the way Helm does — e.g. every order sitting in
 * Despatch Ready, however long it's been there. `statusIds` is a list of Helm
 * status_ids passed as filters[status][].
 */
export async function fetchOrdersByStatus(statusIds, { maxPages = 2000 } = {}) {
  if (!Array.isArray(statusIds) || statusIds.length === 0) return [];
  const all = [];
  let page = 1;
  for (let i = 0; i < maxPages; i++) {
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', '100');
    qs.set('sort', 'datereceived_rp');
    for (const s of statusIds) qs.append('filters[status][]', String(s));
    const res = await authedGet(`/orders?${qs.toString()}`);
    const rows = res.data || [];
    all.push(...rows);
    const lastPage = parseInt(res.last_page) || 1;
    if (!res.next_page_url || page >= lastPage || rows.length === 0) break;
    page++;
  }
  return all;
}

/**
 * Aggregate a list of despatched orders into { 'YYYY-MM-DD': {parcels, items, revenue} }.
 * items   = sum of total_inventory_quantity (units shipped)
 * parcels = sum of shipment[].length, defaulting to 1 parcel per order when the
 *           order carries no explicit shipment/parcel array.
 */
export function aggregateDispatchVolume(orders) {
  const byDate = {};
  for (const o of orders) {
    const day = (o.date_dispatched || '').slice(0, 10);
    if (!day || day.startsWith('0000')) continue;
    const items   = parseInt(o.total_inventory_quantity) || 0;
    const parcels = (Array.isArray(o.shipment) && o.shipment.length) ? o.shipment.length : 1;
    const revenue = parseFloat(o.total_paid) || 0;
    const b = (byDate[day] ||= { parcels: 0, items: 0, revenue: 0 });
    b.parcels += parcels;
    b.items   += items;
    b.revenue += revenue;
  }
  return byDate;
}

// ─── Helm end-consumer contacts (NOT Cloud9 customers — kept for later use) ──
export async function fetchHelmContacts() {
  return fetchAllPages('/customers');
}

// ─── Picking (warehouse pick performance) ────────────────────────────────────
//
// List Picks → page of pick headers; Get Pick Detail → pick_inventories[]
// (quantities + picked_by) and time_tracking_data[] (durations). Pick data is
// pull-only and not available to fulfilment-client users.
// Status: 0 OPEN, 1 COMPLETED, 2 CANCELLED, 3 INPROGRESS, 4 IDLE.

/** Warehouse users — used to turn picker IDs into names. */
export async function fetchUsers() {
  return fetchAllPages('/users');
}

/**
 * List picks created within a window. `from`/`to` are Date objects or ms epochs.
 * Helm filters on `created_at` via two comma-joined UNIX (seconds) timestamps.
 * Optionally restrict to certain status IDs (e.g. [1] = completed only).
 * Paginates on current_page/last_page (the picks envelope has no next_page_url).
 */
export async function fetchPicks({ from, to, statuses = [], perPage = 100, maxPages = 200 } = {}) {
  const fromSec = Math.floor((from instanceof Date ? from.getTime() : Number(from)) / 1000);
  const toSec   = Math.floor((to   instanceof Date ? to.getTime()   : Number(to))   / 1000);
  const all = [];
  let page = 1;
  for (let i = 0; i < maxPages; i++) {
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('per_page', String(perPage));
    qs.set('filters[create_date_range]', `${fromSec},${toSec}`);
    for (const s of statuses) qs.append('filters[status][]', String(s));

    const res = await authedGet(`/picks?${qs.toString()}`);
    const rows = res.data || [];
    all.push(...rows);
    const lastPage = parseInt(res.last_page) || 1;
    const curPage  = parseInt(res.current_page) || page;
    if (rows.length === 0 || curPage >= lastPage) break;
    page++;
  }
  return all;
}

/** Full pick: header + pick_inventories[] + time_tracking_data[]. */
export async function fetchPickDetail(pickId) {
  if (!pickId) throw new Error('pickId required');
  const cleanId = String(pickId).trim();
  try {
    return await authedGet(`/picks/${cleanId}`);
  } catch (err1) {
    try {
      return await authedGet(`/pick/${cleanId}`);
    } catch (err2) {
      try {
        const res = await authedGet('/picks', { 'filters[pick_number]': cleanId, limit: 1 });
        const first = Array.isArray(res?.data) ? res.data[0] : null;
        if (first?.id) {
          try { return await authedGet(`/picks/${first.id}`); } catch {}
          try { return await authedGet(`/pick/${first.id}`); } catch {}
          return first;
        }
      } catch {}
      throw err1;
    }
  }
}

// ─── Inventory & storage (m³ per client) ─────────────────────────────────────
/**
 * List all inventory for one fulfilment client. Each item carries stock_level
 * and a locations[] array (which bins hold it + how much), but NOT package
 * dimensions — those need the detail call.
 */
export async function fetchInventoryForClient({ helmClientId, perPage = 100, maxPages = 200, productTypes = null }) {
  const all = [];
  let page = 1;
  for (let i = 0; i < maxPages; i++) {
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('per_page', String(perPage));
    if (helmClientId != null) qs.append('filters[fulfilment_clients][]', String(helmClientId));
    // type: 1=Inventory, 2=Component, 3=Group, 4=Packaging, 5=Auxiliary Packaging.
    if (Array.isArray(productTypes)) for (const t of productTypes) qs.append('filters[product_types][]', String(t));
    const res = await authedGet(`/inventory?${qs.toString()}`);
    const rows = res.data || [];
    all.push(...rows);
    const lastPage = parseInt(res.last_page) || 1;
    const curPage = parseInt(res.current_page) || page;
    if (rows.length === 0 || curPage >= lastPage) break;
    page++;
    await sleep(100);
  }
  return all;
}

/** Full inventory item incl. package_configurations (dimensions). */
export async function fetchInventoryDetail(id) {
  return authedGet(`/inventory/${id}`);
}

/**
 * Search inventory items across Helm by barcode or search query.
 */
export async function searchInventory({ query: searchTerm, barcode, sku, helmClientId, limit = 50 }) {
  const qs = new URLSearchParams();
  qs.set('limit', String(limit));
  if (helmClientId != null) qs.append('filters[fulfilment_clients][]', String(helmClientId));
  if (barcode) qs.set('filters[barcode]', String(barcode));
  if (sku) qs.set('filters[sku]', String(sku));
  if (searchTerm && !barcode && !sku) qs.set('filters[search]', String(searchTerm));

  const res = await authedGet(`/inventory?${qs.toString()}`);
  return Array.isArray(res?.data) ? res.data : [];
}

/**
 * Update inventory item weight and dimensions in Helm.
 * Dispatches main update and package configuration queries concurrently for speed.
 */
export async function updateInventoryItem(id, data) {
  if (!id) throw new Error('Inventory ID is required to update item in Helm');
  const cleanId = String(id).trim();

  const weightKg = parseFloat(data.weight ?? data.product_weight ?? 0) || 0;
  const l = data.length != null ? parseFloat(data.length) : null;
  const w = data.width != null ? parseFloat(data.width) : null;
  const h = data.height != null ? parseFloat(data.height) : null;

  // 1. Prepare main update payload
  const updatePayload = {
    product_weight: weightKg,
    weight: weightKg,
    weight_unit: 'kg'
  };
  if (l != null && l > 0) { updatePayload.product_length = l; updatePayload.length = l; }
  if (w != null && w > 0) { updatePayload.product_width = w;  updatePayload.width = w; }
  if (h != null && h > 0) { updatePayload.product_height = h; updatePayload.height = h; }

  // 2. Dispatch main update and package configuration fetch concurrently
  const updatePromise = authedMutate('POST', `/inventory/${cleanId}/update`, updatePayload)
    .catch(err => {
      console.warn(`[helm-update] POST /inventory/${cleanId}/update error:`, err.message);
      return { err };
    });

  const detailPromise = fetchInventoryDetail(cleanId)
    .catch(err => {
      console.warn(`[helm-update] Could not fetch detail for item ${cleanId}:`, err.message);
      return null;
    });

  const [updateResult, curRes] = await Promise.all([updatePromise, detailPromise]);

  // 3. Update existing package configurations in parallel
  const current = curRes?.data || curRes || {};
  const existingPkgs = Array.isArray(current.package_configurations) && current.package_configurations.length
    ? current.package_configurations
    : (current.package_configuration ? [current.package_configuration] : []);

  const pkgWithIds = existingPkgs.filter(p => p && p.id);
  if (pkgWithIds.length > 0) {
    const pkgUpdates = pkgWithIds.map(pkg => {
      const pkgPayload = {
        package_configuration_id: parseInt(pkg.id) || pkg.id,
        weight: weightKg,
        product_weight: weightKg,
        length: l != null && l > 0 ? l : (pkg.length ?? 0),
        width: w != null && w > 0 ? w : (pkg.width ?? 0),
        height: h != null && h > 0 ? h : (pkg.height ?? 0)
      };
      return authedMutate('POST', `/inventory/${cleanId}/update_package_configuration`, pkgPayload)
        .catch(pkgErr => {
          console.warn(`[helm-update] Package config update error on pkg ${pkg.id}:`, pkgErr.message);
          return null;
        });
    });

    await Promise.all(pkgUpdates);
  }

  if (updateResult && updateResult.err) {
    throw updateResult.err;
  }

  return updateResult || { ok: true };
}


