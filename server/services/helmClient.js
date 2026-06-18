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

const BASE     = (process.env.HELM_API_BASE || '').replace(/\/$/, '');
const EMAIL    = process.env.HELM_EMAIL || '';
const PASSWORD = process.env.HELM_PASSWORD || '';
const TWO_FA   = process.env.HELM_2FA_CODE || '';

let cachedToken = null;

export function helmConfigured() {
  return Boolean(BASE && EMAIL && PASSWORD);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function login() {
  if (!helmConfigured()) {
    throw new Error('Helm API not configured — set HELM_API_BASE / HELM_EMAIL / HELM_PASSWORD in server/.env');
  }
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, '2fa_code': TWO_FA }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Helm login failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.token) throw new Error('Helm login returned no token');
  cachedToken = data.token;
  return cachedToken;
}

async function token() {
  return cachedToken || login();
}

// ─── Authenticated GET (auto re-login once on 401) ───────────────────────────
async function authedGet(pathOrUrl, params = {}) {
  const url = pathOrUrl.startsWith('http')
    ? new URL(pathOrUrl)
    : new URL(`${BASE}${pathOrUrl}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }

  let t = await token();
  let res = await fetch(url, { headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' } });

  if (res.status === 401) {
    cachedToken = null;
    t = await login();
    res = await fetch(url, { headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' } });
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Helm API ${res.status} on ${url.pathname}: ${body.slice(0, 200)}`);
  }
  return res.json();
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
  return authedGet(`/picks/${pickId}`);
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
  }
  return all;
}

/** Full inventory item incl. package_configurations (dimensions). */
export async function fetchInventoryDetail(id) {
  return authedGet(`/inventory/${id}`);
}

/** One page of warehouse locations (bins/shelves). */
export async function fetchLocations({ page = 1, perPage = 100 } = {}) {
  return authedGet(`/locations?page=${page}&per_page=${perPage}`);
}

/** Full location detail — carries the putaway-plugin capacity fields. */
export async function fetchLocationDetail(id) {
  return authedGet(`/location/${id}`);
}
