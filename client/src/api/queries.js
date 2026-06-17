import { getAuthToken } from '../context/AuthContext';
// Auth-aware fetch — attaches the Cloud9 login token (queries API requires auth).
const authFetch = (url, opts = {}) => {
  const token = getAuthToken();
  const headers = { ...(opts.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  return globalThis.fetch(url, { ...opts, headers });
};

const BASE = '/api/queries';

// ─── Inbox ────────────────────────────────────────────────────────────────────

export async function fetchInbox(params = {}) {
  const qs = new URLSearchParams();
  if (params.status)        qs.set('status',      params.status);
  if (params.courier)       qs.set('courier_code', params.courier);
  if (params.courier_code)  qs.set('courier_code', params.courier_code);
  if (params.query_type)    qs.set('query_type',   params.query_type);
  if (params.attention)     qs.set('attention',    'true');
  if (params.assigned_to)   qs.set('assigned_to',  params.assigned_to);
  if (params.priority)      qs.set('priority',     params.priority);
  if (params.group_name)    qs.set('group_name',   params.group_name);
  if (params.search)        qs.set('search',        params.search);
  if (params.pending_draft)       qs.set('pending_draft',       'true');
  if (params.claim_deadline_days) qs.set('claim_deadline_days',  params.claim_deadline_days);
  if (params.sla_breached)        qs.set('sla_breached',         'true');
  if (params.limit)               qs.set('limit',                params.limit);
  if (params.offset)              qs.set('offset',               params.offset);
  const r = await authFetch(`${BASE}?${qs}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function fetchStats(assignedTo) {
  const qs = assignedTo ? `?assigned_to=${encodeURIComponent(assignedTo)}` : '';
  const r = await authFetch(`${BASE}/stats${qs}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function fetchUnmatched() {
  const r = await authFetch(`${BASE}/unmatched`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function fetchQuery(id) {
  const r = await authFetch(`${BASE}/${id}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function createQuery(body) {
  const r = await authFetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updateQuery(id, body) {
  const r = await authFetch(`${BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function approveEmail(queryId, body) {
  // body must contain email_id (the draft row to approve) and optionally body_text
  const { email_id, body_text } = body;
  const r = await authFetch(`${BASE}/${queryId}/emails/${email_id}/approve`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body_text }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function flagAttention(queryId, body) {
  const r = await authFetch(`${BASE}/${queryId}/attention`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function mapSender(body) {
  const r = await authFetch(`${BASE}/map-sender`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function fetchSenderSuggestions(email) {
  const r = await authFetch(`${BASE}/sender-suggestions?email=${encodeURIComponent(email)}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
