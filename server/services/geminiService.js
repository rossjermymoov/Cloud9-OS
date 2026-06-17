/**
 * geminiService.js — Gemini 1.5 Flash triage extraction
 *
 * Given a customer email, extract the courier, tracking code and issue type so
 * the automation loop can match a template. Returns structured JSON. Falls back
 * to lightweight regex heuristics if the API key is absent or the call fails, so
 * the loop never hard-crashes.
 */

import { ISSUE_TYPES } from './courierTemplates.js';

// v1beta — required for JSON mode (responseMimeType); v1 rejects it with a 400.
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// Generic Gemini 1.5 Flash text generation (REST — Node-18 safe). Replaces the
// legacy Anthropic /v1/messages calls. Throws if the key is missing or the call
// fails so callers can surface a clean error.
export async function geminiGenerate(prompt, { system = '', json = false, maxTokens = 900, temperature = 0.3 } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
  const fullPrompt = system ? `${system}\n\n${prompt}` : prompt;
  const resp = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    }),
  });
  if (!resp.ok) {
    const bodyText = await resp.text();
    const e = new Error(`Gemini API error ${resp.status}: ${bodyText}`);
    e.status = resp.status;           // e.g. 429 rate limit, 503 overloaded
    e.body = bodyText;
    throw e;
  }
  const j = await resp.json();
  return (j.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

const KNOWN_COURIERS = ['dpd', 'dhl', 'evri', 'hermes', 'royal_mail', 'yodel', 'ups', 'fedex', 'parcelforce'];

// Guard against junk being treated as a tracking/consignment number — most
// notably UK phone numbers lifted from signatures (e.g. 01159507190).
export function isLikelyTracking(s) {
  if (!s) return false;
  const t = String(s).replace(/\s+/g, '').trim();
  if (t.length < 8 || t.length > 30) return false;
  if (!/^[A-Za-z0-9]+$/.test(t)) return false;
  if (/^0\d{10,12}$/.test(t)) return false;        // UK phone (11-13 digits, leading 0)
  if (/^\+?44\d{9,12}$/.test(t)) return false;     // +44 international form
  // Tracking refs are digit-heavy; this rejects ordinary words like "apologise".
  if ((t.match(/\d/g) || []).length < 4) return false;
  return true;
}

function regexFallback(subject, body) {
  const text = `${subject || ''} ${body || ''}`.toLowerCase();
  const courier =
    /\bdpd\b/.test(text) ? 'dpd' :
    /\bdhl\b/.test(text) ? 'dhl' :
    /\bevri|hermes\b/.test(text) ? 'evri' :
    null;
  // Only accept a candidate that actually looks like a tracking ref (not a phone).
  const trackCandidate = ((body || '').match(/\b([A-Za-z0-9]{8,30})\b/g) || [])
    .find(isLikelyTracking) || null;
  const issue =
    /damaged|broken|smashed/.test(text)            ? 'DAMAGED' :
    /return to sender|rts/.test(text)              ? 'RETURN_TO_SENDER' :
    /failed deliver|not delivered/.test(text)      ? 'FAILED_DELIVERY' :
    /lost|missing/.test(text)                      ? 'LOST' :
    /no scan|not scanned|no update|stuck/.test(text) ? 'NO_SCAN_24H' :
    'GENERAL';
  // Heuristic acknowledgement filter for the no-key path: treat obvious
  // do-not-reply / automated-receipt noise as non-actionable.
  const noise = /(do not reply|do-not-reply|noreply|no-reply|automated (response|message|receipt)|this is an automated|ticket (has been )?(created|received|logged)|case reference|out of office)/i.test(text);

  return {
    intent: courier ? 'courier_chase' : 'other',
    courier_code: courier,
    tracking_code: trackCandidate,
    issue_type: issue,
    needs_human: !courier,
    needs_human_triage: !courier,
    requires_reply: !noise,
    reason: courier ? null : 'Courier could not be identified from the email.',
    has_required_context: true,        // fallback can't assess — let validators decide
    missing_variables: [],
    contextual_clarification_draft: null,
    source: 'regex_fallback',
  };
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Build the shared triage prompt (used by every LLM tier).
function buildTriagePrompt(subject, body, trackingExamples) {
  const trackingGuide = trackingExamples
    ? `\nVALID TRACKING NUMBER FORMATS (real examples from our system, per courier):\n${trackingExamples}\n` +
      `The tracking_code MUST structurally match one of these formats (length + character types). ` +
      `IGNORE anything that doesn't — signature markers like [signature_12345678], phone numbers, order refs. ` +
      `If nothing in the email matches a real format, set tracking_code to null.\n`
    : '';
  return (
    `You are triaging a parcel support email for a courier reseller.\n` +
    `Return STRICT JSON only with keys: intent, courier_code, tracking_code, issue_type, needs_human, requires_reply, reason, has_required_context, missing_variables, contextual_clarification_draft.\n` +
    `- intent: the transactional intent — one of ["courier_chase","ticket_closure","information_request","complaint","other"]. ` +
    `Use "ticket_closure" when the customer is simply confirming resolution, saying thanks, or otherwise needs no further outward action.\n` +
    `  HIGH-CONFIDENCE RULE: if the latest message uses final-state language (e.g. "parcel has now been delivered", ` +
    `"successfully delivered", "received it", "thank you for your help, please close", "all sorted", "no further action") ` +
    `you MUST set intent = "ticket_closure" AND has_required_context = true. Judge ONLY the most recent message, ` +
    `not older thread history or the subject line.\n` +
    `- courier_code: one of ${KNOWN_COURIERS.join(', ')} (lowercase), or null if not stated.\n` +
    `- tracking_code: the consignment/tracking number if present, else null.\n` +
    trackingGuide +
    `- issue_type: one of ${ISSUE_TYPES.join(', ')}.\n` +
    `- needs_human: true if a human agent is required (no courier, unclear, complaint/escalation), else false.\n` +
    `  Set this to true whenever you cannot confidently categorise the email or map it to a structured rule.\n` +
    `- requires_reply: true if this email needs an actionable response. Set FALSE for automated corporate noise — ` +
    `automated ticket receipts/confirmations, 'do not reply' templates, out-of-office, or claim references that carry ` +
    `no new/dynamic status change. When in doubt, set true.\n` +
    `- reason: short string when needs_human is true, else null.\n` +
    `- has_required_context: given the inferred intent, do we have EVERY mandatory operational detail needed to action ` +
    `or escalate this? false if anything essential is missing (tracking number, order reference, item description, ` +
    `delivery address, etc.), else true.\n` +
    `- missing_variables: array of the specific missing detail names, e.g. ["tracking_number"], ["order_number","delivery_address"]; [] when nothing is missing.\n` +
    `- contextual_clarification_draft: when has_required_context is false, a warm, professional British-English email BODY ` +
    `(NO greeting, NO sign-off — body paragraphs only) that clearly asks the customer to provide exactly the missing_variables; else null.\n\n` +
    `Subject: ${subject || '(none)'}\nBody: ${(body || '').slice(0, 2000)}`
  );
}

// Tolerant JSON parse — handles models that wrap JSON in prose / code fences.
function parseJsonLoose(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch { /* try to extract a JSON object */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error('No JSON object in response');
}

// Normalise any model's parsed JSON into our guarded triage shape.
const INTENTS = ['courier_chase', 'ticket_closure', 'information_request', 'complaint', 'other'];

function normalizeTriage(parsed, source) {
  return {
    intent: INTENTS.includes(parsed.intent) ? parsed.intent : 'other',
    courier_code: parsed.courier_code ? String(parsed.courier_code).toLowerCase() : null,
    tracking_code: isLikelyTracking(parsed.tracking_code) ? String(parsed.tracking_code).trim() : null,
    issue_type: ISSUE_TYPES.includes(parsed.issue_type) ? parsed.issue_type : 'GENERAL',
    needs_human: !!parsed.needs_human || !parsed.courier_code,
    needs_human_triage: !!parsed.needs_human || !!parsed.needs_human_triage || !parsed.courier_code,
    requires_reply: parsed.requires_reply !== false,
    reason: parsed.reason || (parsed.courier_code ? null : 'Courier not identified.'),
    has_required_context: parsed.has_required_context !== false,
    missing_variables: Array.isArray(parsed.missing_variables) ? parsed.missing_variables.map(v => String(v).trim()).filter(Boolean) : [],
    contextual_clarification_draft: parsed.contextual_clarification_draft ? String(parsed.contextual_clarification_draft).trim() : null,
    source,
  };
}

// Tier 1 — Gemini (throws on any non-200 so the cascade can fall through).
async function callGemini(prompt) {
  const resp = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  });
  if (!resp.ok) { const e = new Error(`Gemini ${resp.status}: ${await resp.text()}`); e.status = resp.status; throw e; }
  const j = await resp.json();
  return parseJsonLoose(j.candidates?.[0]?.content?.parts?.[0]?.text || '');
}

// Tier 2 — Anthropic Claude 3.5 Sonnet (REST; Node-18 safe, no SDK).
async function callAnthropic(prompt) {
  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 1024,
      temperature: 0,
      system: 'You are a logistics triage engine. Output ONLY a single valid JSON object — no prose, no markdown.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) { const e = new Error(`Anthropic ${resp.status}: ${await resp.text()}`); e.status = resp.status; throw e; }
  const j = await resp.json();
  return parseJsonLoose(j.content?.[0]?.text || '');
}

// Multi-LLM failover triage: Gemini → Anthropic → deterministic regex floor.
// Every tier returns the identical schema so the 3-panel dashboard is unaffected.
export async function extractTriage(subject, body, { trackingExamples = '' } = {}) {
  const prompt = buildTriagePrompt(subject, body, trackingExamples);

  // Tier 1 — Gemini
  if (process.env.GEMINI_API_KEY) {
    try { return normalizeTriage(await callGemini(prompt), 'gemini-2.5-flash'); }
    catch (e) { console.warn('[Triage] Tier 1 Gemini failed → trying Anthropic:', e.message); }
  }

  // Tier 2 — Anthropic Claude 3.5 Sonnet
  if (process.env.ANTHROPIC_API_KEY) {
    try { return normalizeTriage(await callAnthropic(prompt), 'claude-3-5-sonnet'); }
    catch (e) { console.warn('[Triage] Tier 2 Anthropic failed → falling back to regex:', e.message); }
  }

  // Tier 3 — deterministic regex floor (never throws)
  return regexFallback(subject, body);
}
