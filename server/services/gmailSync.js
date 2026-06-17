/**
 * gmailSync.js — Polls Gmail inbox and imports emails as tickets.
 * Read-only. Never sends or modifies Gmail messages.
 */

import { google } from 'googleapis';

// ─── AI triage + summary via Gemini 1.5 Flash (REST — Node-18 safe) ──────────
// Returns strict JSON: { ticket_type, summary, courier, tracking_number }.
// ticket_type ∈ ['query','claim','billing','technical']. Falls back to regex
// heuristics if the API key is missing or the call fails, so the sync never
// hard-crashes.
const GEMINI_GENERATE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

function triageFallback(subject, body) {
  const text = `${subject || ''} ${body || ''}`.toLowerCase();
  const ticket_type =
    /claim|compensation|refund|damaged|lost/.test(text)        ? 'claim' :
    /invoice|billing|statement|payment|account|charge/.test(text) ? 'billing' :
    /login|error|bug|portal|dashboard|api|technical|access/.test(text) ? 'technical' :
    'query';
  const courier =
    /\bdpd\b/.test(text)            ? 'DPD' :
    /\bdhl\b/.test(text)            ? 'DHL' :
    /\bevri|hermes\b/.test(text)    ? 'Evri' :
    /royal mail/.test(text)         ? 'Royal Mail' :
    /\byodel\b/.test(text)          ? 'Yodel' :
    null;
  const track = ((body || '').match(/\b([A-Za-z0-9]{8,30})\b/g) || []).find(isLikelyTracking) || null;
  return {
    ticket_type,
    summary: (subject || 'Customer enquiry').slice(0, 200),
    courier,
    tracking_number: track,
    source: 'regex_fallback',
  };
}

export async function triageAndSummarize(subject, body) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return triageFallback(subject, body);

  const trackingExamples = await getAllTrackingExamples();
  const trackingGuide = trackingExamples
    ? `\nVALID TRACKING NUMBER FORMATS (real examples from our system, per courier):\n${trackingExamples}\n` +
      `tracking_number MUST structurally match one of these (length + character types). IGNORE signature ` +
      `markers like [signature_12345678], phone numbers and order refs; set null if nothing matches.\n`
    : '';

  const prompt =
    `You are triaging a parcel-courier support email. Return STRICT JSON only with keys:\n` +
    `- ticket_type: exactly one of ["query","claim","billing","technical"].\n` +
    `- summary: max 2 sentences describing the core issue (no "The email"/"This email").\n` +
    `- courier: the courier name (e.g. "DPD","DHL","Evri") or null if none mentioned.\n` +
    `- tracking_number: the tracking/consignment number if present, else null.\n` +
    trackingGuide +
    `\nSubject: ${subject || '(none)'}\nBody: ${(body || '').slice(0, 2000)}`;

  try {
    const resp = await fetch(`${GEMINI_GENERATE_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (!resp.ok) { console.warn('[Gemini triage] non-OK:', resp.status); return triageFallback(subject, body); }
    const json = await resp.json();
    const parsed = JSON.parse(json.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
    const allowed = ['query', 'claim', 'billing', 'technical'];
    return {
      ticket_type: allowed.includes(parsed.ticket_type) ? parsed.ticket_type : 'query',
      summary: (parsed.summary || subject || 'Customer enquiry').toString().slice(0, 400),
      courier: parsed.courier || null,
      tracking_number: isLikelyTracking(parsed.tracking_number) ? String(parsed.tracking_number).trim() : null,
      source: 'gemini-2.5-flash',
    };
  } catch (e) {
    console.warn('[Gemini triage] failed:', e.message);
    return triageFallback(subject, body);
  }
}

// Backward-compatible: existing callers that only need the summary string.
export async function generateSummary(subject, body) {
  return (await triageAndSummarize(subject, body)).summary;
}

// ticket_type ('query'/'claim'/'billing'/'technical') routes to the group_name
// column — the Claims/Queries/Billing/Technical taxonomy the inbox tabs use.
// (query_type is a separate, fixed enum of parcel issue types, so it isn't used
// for this.)
const GROUP_BY_TICKET_TYPE = {
  query:     'Queries',
  claim:     'Claims',
  billing:   'Billing',
  technical: 'Technical',
};


import { getAuthedClient, getConfig, updateLastSync } from './gmailService.js';
import { query } from '../db/index.js';
import { applySlaTriggers } from './slaEngine.js';
import { triagePriority } from './triageEngine.js';
import { isLikelyTracking } from './geminiService.js';
import { identifyCourierByTracking, getAllTrackingExamples, draftCustomerUpdateFromCourier } from './courierAutomation.js';

// Sender domains that are couriers / our wholesaler (AGL) — never the customer.
const COURIER_DOMAINS = /@(?:[a-z0-9-]+\.)*(dpd|dhl|evri|hermes|myhermes|yodel|ups|parcelforce|royalmail|fedex|agl)\.[a-z.]{2,}/i;

// Find the original ticket a courier reply belongs to, by the tracking number(s)
// in its body — covering DPD's 1550-prefixed vs bare 10-digit forms.
async function findTicketByTrackingInBody(body) {
  const tokens = (String(body || '').match(/\b[A-Za-z0-9]{8,30}\b/g) || []).filter(isLikelyTracking);
  if (!tokens.length) return null;
  const variants = new Set();
  for (const tok of tokens) {
    const u = tok.toUpperCase();
    variants.add(u);
    const m = u.match(/^1550(\d{10}[A-Z]?)$/); if (m) variants.add(m[1]);   // strip DPD 1550
    if (/^\d{10}[A-Z]?$/.test(u)) variants.add('1550' + u);                 // add DPD 1550
  }
  const r = await query(
    `SELECT id FROM queries
      WHERE upper(consignment_number) = ANY($1)
        AND status NOT IN ('resolved','resolved_claim_approved','resolved_claim_rejected')
      ORDER BY created_at DESC LIMIT 1`,
    [[...variants]],
  );
  return r.rows[0]?.id || null;
}

function decodeBase64(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractHeader(headers, name) {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

// Convert an HTML email body into readable plain text, preserving line breaks
// (so signatures/quoted sections still detect correctly downstream).
function htmlToText(html) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Recursively gather every text/plain and text/html part in the MIME tree.
function collectParts(payload, acc) {
  if (!payload) return acc;
  const mt = payload.mimeType || '';
  if (payload.body?.data) {
    if (mt === 'text/plain')      acc.plain.push(decodeBase64(payload.body.data));
    else if (mt === 'text/html')  acc.html.push(decodeBase64(payload.body.data));
    else if (!mt.startsWith('multipart/')) acc.other.push(decodeBase64(payload.body.data));
  }
  if (payload.parts) for (const p of payload.parts) collectParts(p, acc);
  return acc;
}

export function extractBody(payload) {
  if (!payload) return '';
  const acc      = collectParts(payload, { plain: [], html: [], other: [] });
  const plain    = acc.plain.join('\n').trim();
  const htmlText = acc.html.length ? htmlToText(acc.html.join('\n')) : '';
  // Prefer the part with real content. Sparse plain-text alternatives (common
  // from Outlook — sometimes just a greeting) lose to the full HTML body.
  if (plain && (!htmlText || plain.length >= htmlText.length * 0.6)) return plain;
  if (htmlText) return htmlText;
  return plain || acc.other.join('\n').trim() || '';
}

// Gmail returns larger MIME parts by reference (body.attachmentId) instead of
// inline (body.data) — common for rich HTML bodies with images/long signatures.
// Fetch those text parts so extractBody() can see the real content.
export async function hydratePayload(gmail, messageId, payload) {
  if (!payload) return payload;
  const mt = payload.mimeType || '';
  if ((mt === 'text/plain' || mt === 'text/html') && !payload.body?.data && payload.body?.attachmentId) {
    try {
      const att = await gmail.users.messages.attachments.get({
        userId: 'me', messageId, id: payload.body.attachmentId,
      });
      if (att.data?.data) payload.body.data = att.data.data;
    } catch { /* leave the part as-is if it can't be fetched */ }
  }
  if (payload.parts) for (const p of payload.parts) await hydratePayload(gmail, messageId, p);
  return payload;
}

function partHeader(part, name) {
  return (part.headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

// Walk the tree collecting inline images keyed by their Content-ID, fetching
// by-reference parts as needed. Returns { cid: 'data:...' }.
async function collectInlineImages(gmail, messageId, payload, map) {
  if (!payload) return map;
  const mt = payload.mimeType || '';
  if (mt.startsWith('image/')) {
    let cid = (partHeader(payload, 'Content-ID') || '').replace(/^<|>$/g, '').trim();
    let data = payload.body?.data;
    if (!data && payload.body?.attachmentId) {
      try {
        const a = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: payload.body.attachmentId });
        data = a.data?.data;
      } catch { /* skip image we can't fetch */ }
    }
    if (cid && data) map[cid] = `data:${mt};base64,${data.replace(/-/g, '+').replace(/_/g, '/')}`;
  }
  if (payload.parts) for (const p of payload.parts) await collectInlineImages(gmail, messageId, p, map);
  return map;
}

// Build a self-contained HTML body: the text/html part with all cid: image
// references swapped for inline data URIs, so it renders standalone.
export async function buildInlineHtml(gmail, messageId, payload) {
  await hydratePayload(gmail, messageId, payload);
  const acc = collectParts(payload, { plain: [], html: [], other: [] });
  if (!acc.html.length) return '';
  let html = acc.html.join('\n');
  const images = await collectInlineImages(gmail, messageId, payload, {});
  html = html.replace(/(src\s*=\s*["']?)cid:([^"'>\s]+)(["']?)/gi, (m, pre, cid, post) => {
    const uri = images[cid.trim()];
    return uri ? `${pre}${uri}${post}` : m;
  });
  return html;
}

// Senders on one of our support domains are treated as outbound ("our reply").
const SUPPORT_DOMAINS = /@(moovparcel\.co\.uk|moov-os\.com|moovparcel\.com)$/i;

function parseFrom(fromHeader) {
  const match = fromHeader.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].trim().toLowerCase() };
  return { name: '', email: fromHeader.trim().toLowerCase() };
}

async function resolveCustomer(senderEmail) {
  let res = await query(`SELECT id, business_name, tier FROM customers WHERE lower(primary_email) = $1 LIMIT 1`, [senderEmail.toLowerCase()]);
  if (res.rows[0]) return res.rows[0];
  res = await query(`SELECT id, business_name, tier FROM customers WHERE lower(accounts_email) = $1 LIMIT 1`, [senderEmail.toLowerCase()]);
  if (res.rows[0]) return res.rows[0];
  const domain = senderEmail.split('@')[1];
  if (domain && !['gmail.com','hotmail.com','outlook.com','yahoo.com','yahoo.co.uk','icloud.com'].includes(domain)) {
    res = await query(`SELECT id, business_name, tier FROM customers WHERE primary_email ILIKE $1 LIMIT 1`, [`%@${domain}`]);
    if (res.rows[0]) return res.rows[0];
  }
  return null;
}

async function upsertTicket(msg, gmail = null) {
  const { id: gmailMsgId, threadId: gmailThreadId, payload, internalDate, labelIds = [] } = msg;

  // Skip if already imported — before any expensive parsing/HTML work.
  const exists = await query(`SELECT id FROM query_emails WHERE gmail_message_id = $1 LIMIT 1`, [gmailMsgId]);
  if (exists.rows.length) return { status: 'skipped', reason: 'already imported' };

  if (gmail) await hydratePayload(gmail, gmailMsgId, payload);
  const headers    = payload?.headers || [];
  const subject    = extractHeader(headers, 'subject') || '(no subject)';
  const fromHeader = extractHeader(headers, 'from');
  const inReplyTo  = extractHeader(headers, 'in-reply-to');
  const body       = extractBody(payload) || '(no body)';
  const bodyHtml   = gmail ? await buildInlineHtml(gmail, gmailMsgId, payload).catch(() => '') : '';
  const { name: senderName, email: senderEmail } = parseFrom(fromHeader);
  const receivedAt = internalDate ? new Date(parseInt(internalDate)) : new Date();

  if (!senderEmail) return { status: 'skipped', reason: 'no sender email' };

  // Our own SENT messages (or anything from a support domain) are outbound.
  const isOurs = labelIds.includes('SENT') || SUPPORT_DOMAINS.test(senderEmail);
  // A courier/AGL sender is NEVER the customer — classify as inbound_courier.
  const isCourierSender = !isOurs && COURIER_DOMAINS.test(senderEmail);
  const direction = isOurs ? 'outbound_customer' : isCourierSender ? 'inbound_courier' : 'inbound_customer';

  const customer = isCourierSender ? null : await resolveCustomer(senderEmail);

  // Find the ticket this Gmail thread belongs to.
  //  • Our own reply (outbound) attaches to its thread under ANY status —
  //    open, pending, resolved or closed — so sent replies are never dropped.
  //  • An inbound customer message prefers an open ticket; a brand-new message
  //    on a long-resolved thread is allowed to spin up a fresh ticket below.
  let queryId = null;
  if (gmailThreadId) {
    const sql = isOurs
      ? `SELECT q.id FROM queries q
         JOIN query_emails qe ON qe.query_id = q.id
         WHERE qe.gmail_thread_id = $1
         ORDER BY q.created_at DESC LIMIT 1`
      : `SELECT q.id FROM queries q
         JOIN query_emails qe ON qe.query_id = q.id
         WHERE qe.gmail_thread_id = $1
           AND q.status NOT IN ('resolved','resolved_claim_approved','resolved_claim_rejected')
         ORDER BY q.created_at DESC LIMIT 1`;
    const match = await query(sql, [gmailThreadId]);
    if (match.rows[0]) queryId = match.rows[0].id;
  }

  // A courier replied outside our thread — route it back to the ORIGINAL ticket
  // by the tracking number, never spin up a new "DPD-as-customer" ticket.
  if (!queryId && isCourierSender) {
    queryId = await findTicketByTrackingInBody(`${subject}\n${body}`);
    if (!queryId) {
      console.warn(`[Gmail sync] Courier reply from ${senderEmail} unmatched to any ticket (no tracking match) — skipped`);
      return { status: 'skipped', reason: 'courier reply with no matching ticket' };
    }
    console.log(`[Gmail sync] Courier reply from ${senderEmail} routed to original ticket ${queryId} via tracking`);
  }

  if (!queryId) {
    // Only skip an outbound message when the thread has NO ticket at all (e.g. a
    // cold outbound we initiated) — never create a ticket from our own reply.
    if (isOurs) {
      console.warn(`[Gmail sync] Outbound reply NOT stored — no ticket for thread ${gmailThreadId} (from ${senderEmail})`);
      return { status: 'skipped', reason: 'outbound with no existing thread' };
    }
    // Gemini triage — drives group routing, summary, courier and tracking.
    const triage      = await triageAndSummarize(subject, body);
    const groupName   = GROUP_BY_TICKET_TYPE[triage.ticket_type] || 'Queries';
    const tracking    = triage.tracking_number || null;

    // Resolve courier — never store AGL (wholesaler). Strip it, then identify
    // Evri vs Yodel from the tracking number's shape when the text didn't say.
    let courierName = triage.courier || null;
    if (courierName && /^agl$/i.test(courierName.trim())) courierName = null;
    let courierCode = courierName ? courierName.toLowerCase().replace(/\s+/g, '_') : null;
    if (!courierCode && tracking) {
      const id = await identifyCourierByTracking(tracking);
      if (id) { courierCode = id.courier_code; courierName = id.courier_name; }
    }

    const ticketRes = await query(`
      INSERT INTO queries
        (customer_id, customer_name, sender_email, sender_matched, subject, description,
         status, query_type, group_name, courier_name, courier_code, consignment_number,
         trigger, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'open', 'other', $7, $8, $9, $10, 'customer_email', $11, $11)
      RETURNING id
    `, [
      customer?.id || null,
      customer?.business_name || senderName || senderEmail,
      senderEmail,
      customer != null,
      subject,
      triage.summary,
      groupName,
      courierName,
      courierCode,
      tracking,
      receivedAt,
    ]);
    queryId = ticketRes.rows[0].id;

    // IF/THEN SLA triggers — may override priority and start the SLA clock.
    let triggerPriority = null;
    try {
      const sla = await applySlaTriggers(queryId, { subject, senderEmail, courierCode, body, customerTier: customer?.tier });
      triggerPriority = sla.priority;
    } catch (e) {
      console.warn('[Gmail sync] SLA trigger evaluation failed:', e.message);
    }

    // Hybrid triage — only when no hard SLA trigger already forced a priority.
    // Phase 1 hard rules (P1 → urgent) then Phase 2 Gemini grader (high/medium/low).
    if (!triggerPriority) {
      try {
        const { priority } = await triagePriority({ subject, body });
        await query(`UPDATE queries SET priority = $1 WHERE id = $2`, [priority, queryId]);
      } catch (e) {
        console.warn('[Gmail sync] Hybrid triage failed:', e.message);
      }
    }
  }

  await query(`
    INSERT INTO query_emails (query_id, direction, from_address, subject, body_text, body_html, received_at, gmail_message_id, gmail_thread_id, in_reply_to, is_ai_draft, sent_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $11)
  `, [queryId, direction, senderEmail, subject, body.slice(0, 50000), bodyHtml ? bodyHtml.slice(0, 2000000) : null, receivedAt, gmailMsgId, gmailThreadId || null, inReplyTo || null, isOurs ? receivedAt : null]);

  await query(`UPDATE queries SET updated_at = NOW() WHERE id = $1`, [queryId]);
  if (isOurs) console.log(`[Gmail sync] Stored OUTBOUND reply on ticket ${queryId} (thread ${gmailThreadId}, from ${senderEmail})`);

  // Courier reply stored on the original ticket → translate it into a draft back
  // to the ORIGINAL customer (never reply to the courier).
  if (isCourierSender) {
    try { await draftCustomerUpdateFromCourier(queryId, body); }
    catch (e) { console.warn('[Gmail sync] courier→customer translation failed:', e.message); }
  }

  return { status: 'imported', queryId };
}

// ─── Main sync — returns result summary ──────────────────────────────────────
export async function syncGmail() {
  const config = await getConfig();
  if (!config?.refresh_token) return { error: 'Gmail not connected' };

  const auth = await getAuthedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  // Always poll messages.list for BOTH inbox and sent. We deliberately no longer
  // rely on history.list: Google does not raise a reliable messageAdded event
  // for messages sent through an external SMTP client, so those replies were
  // being missed entirely. A direct query catches both sides every run.
  const fetchMethod = 'list (in:inbox OR in:sent)';
  // Strict 1-hour rolling window — the precise cutoff is enforced per-message
  // below (Gmail's after: is only day-granular). This is the only rule: anything
  // received in the last hour is ingested, regardless of when a wipe happened.
  const since = Math.floor((Date.now() - 1 * 3600000) / 1000);

  let messageIds = [];
  let pageToken;
  do {
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: `(in:inbox OR in:sent) after:${since}`,
      maxResults: 200,
      pageToken,
    });
    (listRes.data.messages || []).forEach(m => messageIds.push(m.id));
    pageToken = listRes.data.nextPageToken;
  } while (pageToken && messageIds.length < 1000);   // hard cap for safety

  const results = { fetched: messageIds.length, imported: 0, skipped: 0, errors: [], fetchMethod };

  // Fetch everything first, then process strictly oldest → newest so a thread's
  // inbound message creates the ticket before its outbound reply is attached.
  const fetchedMsgs = [];
  for (const id of messageIds) {
    try {
      const msgRes = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const labels = msgRes.data.labelIds || [];
      // Allow anything carrying the INBOX or SENT label through to processing.
      const isValidLabel = labels.some(l => ['INBOX', 'SENT'].includes(l));
      if (!isValidLabel) { results.skipped++; continue; }
      // Gmail's `after:` is only day-granular, so enforce the precise cutoff
      // here with the message's exact timestamp — this is what actually limits
      // us to the rolling window / post-wipe floor.
      const internalMs = parseInt(msgRes.data.internalDate || '0', 10);
      if (internalMs < since * 1000) { results.skipped++; continue; }
      fetchedMsgs.push(msgRes.data);
    } catch (e) {
      console.error('[Gmail fetch]', e.message);
      results.errors.push({ id, error: e.message });
    }
  }
  fetchedMsgs.sort((a, b) => parseInt(a.internalDate || 0) - parseInt(b.internalDate || 0));

  for (const data of fetchedMsgs) {
    try {
      const r = await upsertTicket(data, gmail);
      if (r.status === 'imported') results.imported++;
      else results.skipped++;
    } catch (e) {
      console.error('[Gmail upsertTicket]', e.message);
      results.errors.push({ id: data.id, error: e.message });
    }
  }
  // If every message errored, surface the first error clearly
  if (results.errors.length > 0 && results.imported === 0) {
    results.first_error = results.errors[0]?.error;
  }

  // Keep the historyId fresh for other consumers, but the sync no longer
  // depends on it — non-fatal if it fails.
  try {
    const profileRes = await gmail.users.getProfile({ userId: 'me' });
    await updateLastSync(profileRes.data.historyId);
  } catch (e) { console.warn('[Gmail sync] historyId update skipped:', e.message); }

  // Backfill any tickets that are missing summaries
  await backfillSummaries();

  console.log(`[Gmail sync] ${fetchMethod} — fetched ${results.fetched}, imported ${results.imported}, skipped ${results.skipped}, errors ${results.errors.length}`);
  return results;
}

// ─── Backfill missing summaries on existing tickets ──────────────────────────
export async function backfillSummaries() {
  const res = await query(`
    SELECT DISTINCT ON (q.id) q.id, q.subject, qe.body_text
    FROM queries q
    LEFT JOIN query_emails qe ON qe.query_id = q.id
      AND qe.direction = 'inbound_customer'
    WHERE q.description IS NULL
    ORDER BY q.id, qe.received_at ASC
  `);

  console.log(`[Gmail sync] Backfilling summaries for ${res.rows.length} tickets...`);
  for (const row of res.rows) {
    const summary = await generateSummary(row.subject, row.body_text || '');
    await query(`UPDATE queries SET description = $1 WHERE id = $2`, [summary, row.id]);
  }
  if (res.rows.length) console.log(`[Gmail sync] Backfill complete — ${res.rows.length} tickets updated`);
}

// ─── One-time repair of emails imported before the body-parsing fix ──────────
// Re-fetches already-imported Gmail messages and re-parses them with the
// corrected extractBody(). Guarded by a marker row so it runs once, ever.
// Safe by design: only overwrites a body when more content is recovered.
const EMAIL_BACKFILL_KEY = 'email_bodies_html_v3';

export async function backfillEmailBodiesOnce() {
  // Marker table — created on demand so no migration is needed.
  await query(`
    CREATE TABLE IF NOT EXISTS app_backfill_markers (
      key          TEXT PRIMARY KEY,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const done = await query(`SELECT 1 FROM app_backfill_markers WHERE key = $1`, [EMAIL_BACKFILL_KEY]);
  if (done.rows.length) return; // already repaired — skip silently

  const auth = await getAuthedClient();
  if (!auth) { console.log('[Email backfill] Gmail not connected — will retry on next deploy.'); return; }
  const gmail = google.gmail({ version: 'v1', auth });

  // Backfill any email missing its rendered HTML (and repair short text bodies).
  const { rows } = await query(`
    SELECT id, gmail_message_id, body_text
      FROM query_emails
     WHERE gmail_message_id IS NOT NULL
       AND (body_html IS NULL OR length(COALESCE(body_text, '')) < 400)
     ORDER BY received_at DESC
  `);
  console.log(`[Email backfill] Checking ${rows.length} email(s)…`);

  let updated = 0;
  for (const row of rows) {
    try {
      const res     = await gmail.users.messages.get({ userId: 'me', id: row.gmail_message_id, format: 'full' });
      await hydratePayload(gmail, row.gmail_message_id, res.data.payload);
      const fresh   = (extractBody(res.data.payload) || '').trim();
      const current = (row.body_text || '').trim();
      const html    = await buildInlineHtml(gmail, row.gmail_message_id, res.data.payload).catch(() => '');
      const newText = (fresh && fresh.length > current.length) ? fresh.slice(0, 50000) : null;
      if (newText !== null || html) {
        await query(
          `UPDATE query_emails
              SET body_text = COALESCE($1, body_text),
                  body_html = COALESCE($2, body_html)
            WHERE id = $3`,
          [newText, html ? html.slice(0, 2000000) : null, row.id]
        );
        updated++;
      }
    } catch (e) {
      if (!(e?.code === 404 || e?.response?.status === 404)) {
        console.warn(`[Email backfill] ${row.id}: ${e.message}`);
      }
    }
    await new Promise(r => setTimeout(r, 120)); // stay under Gmail rate limits
  }

  await query(
    `INSERT INTO app_backfill_markers (key) VALUES ($1) ON CONFLICT (key) DO NOTHING`,
    [EMAIL_BACKFILL_KEY]
  );
  console.log(`[Email backfill] Done — ${updated} email(s) repaired.`);
}

// One-time backfill: walk every existing thread and import the SENT replies that
// the old inbox-only sync never captured, so existing tickets become two-sided.
const SENT_BACKFILL_KEY = 'sent_replies_v2';

export async function backfillSentRepliesOnce() {
  await query(`
    CREATE TABLE IF NOT EXISTS app_backfill_markers (
      key TEXT PRIMARY KEY, completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const done = await query(`SELECT 1 FROM app_backfill_markers WHERE key = $1`, [SENT_BACKFILL_KEY]);
  if (done.rows.length) return;

  const auth = await getAuthedClient();
  if (!auth) { console.log('[Sent backfill] Gmail not connected — will retry on next deploy.'); return; }
  const gmail = google.gmail({ version: 'v1', auth });

  const { rows } = await query(`SELECT DISTINCT gmail_thread_id FROM query_emails WHERE gmail_thread_id IS NOT NULL`);
  console.log(`[Sent backfill] Scanning ${rows.length} thread(s) for missing replies…`);

  let imported = 0;
  for (const { gmail_thread_id } of rows) {
    try {
      const thread = await gmail.users.threads.get({ userId: 'me', id: gmail_thread_id, format: 'full' });
      for (const m of (thread.data.messages || [])) {
        const r = await upsertTicket(m, gmail);   // dedups + stores outbound on existing thread
        if (r.status === 'imported') imported++;
      }
    } catch { /* skip this thread on error */ }
    await new Promise(r => setTimeout(r, 150));   // stay under Gmail rate limits
  }

  await query(`INSERT INTO app_backfill_markers (key) VALUES ($1) ON CONFLICT (key) DO NOTHING`, [SENT_BACKFILL_KEY]);
  console.log(`[Sent backfill] Done — ${imported} reply(ies) imported.`);
}

export function startGmailSync(intervalMs = 3 * 60 * 1000) {
  syncGmail().catch(e => console.error('[Gmail sync] Startup error:', e.message));
  setInterval(() => syncGmail().catch(e => console.error('[Gmail sync] Interval error:', e.message)), intervalMs);
  console.log(`[Gmail sync] Polling every ${intervalMs / 60000} minutes`);
}
