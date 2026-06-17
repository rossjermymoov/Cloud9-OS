/**
 * courierAutomation.js — Split-Timeline Courier Orchestration (sandbox mode)
 *
 * The autonomous loop, draft-first: a customer email is triaged by Gemini,
 * matched to a courier template, and TWO drafts are created — a confirmation to
 * the customer and a structured inquiry to the courier — plus a 24h courier SLA.
 * Nothing is sent; agents approve drafts via the existing AI-draft UI. Flip
 * `AUTO_SEND` on once you trust it.
 */

import { query } from '../db/index.js';
import { extractTriage, geminiGenerate, isLikelyTracking } from './geminiService.js';
import { matchTemplate, fillTemplate } from './courierTemplates.js';

const DEFAULT_SLA_HOURS = 24;
const SUPPORT_FROM = 'service@moovparcel.co.uk';

// Issue types that should route to the courier's claims/disputes inbox.
const CLAIM_ISSUES = new Set(['DAMAGED', 'LOST', 'RETURN_TO_SENDER']);

async function insertDraft(queryId, direction, subject, body, toAddress = null) {
  await query(
    `INSERT INTO query_emails
       (query_id, direction, subject, body_text, from_address, to_address, is_ai_draft, reply_to_message_id, created_at)
     VALUES ($1, $2::email_direction, $3, $4, $5, $6, true,
       (SELECT id FROM query_emails
         WHERE query_id = $1 AND direction IN ('inbound_customer','inbound_courier')
         ORDER BY COALESCE(received_at, created_at) DESC LIMIT 1),
       NOW())`,
    [queryId, direction, subject, body, SUPPORT_FROM, toAddress],
  );
}

// Default Top-and-Tail boilerplate, used when a courier has no custom row.
const DEFAULT_TEMPLATES = {
  courier_header_template:  'Dear Carrier Team,',
  courier_footer_template:  'Many thanks,\nMoov Parcel Team',
  customer_header_template: 'Hi {{customer_name}},\n\nHere is an operational update regarding your delivery:',
  customer_footer_template: 'Kind regards,\nMoov Parcel Support Team',
};

// Resolve a courier's Top-and-Tail templates with a per-field cascade:
//   courier-specific row  →  'default' (House style) row  →  built-in fallback.
export async function getCourierTemplates(courierCode) {
  const out = { ...DEFAULT_TEMPLATES };
  try {
    const codes = ['default'];
    const code  = courierCode ? courierCode.toLowerCase() : null;
    if (code && code !== 'default') codes.push(code);

    const r = await query(
      `SELECT courier_code, courier_header_template, courier_footer_template,
              customer_header_template, customer_footer_template
         FROM courier_routing_rules WHERE courier_code = ANY($1)`,
      [codes],
    );
    const byCode = Object.fromEntries(r.rows.map(row => [row.courier_code, row]));

    // Apply default first, then let the courier-specific row override per field.
    for (const c of ['default', code]) {
      const row = c && byCode[c];
      if (row) for (const k of Object.keys(DEFAULT_TEMPLATES)) if (row[k] != null) out[k] = row[k];
    }
    return out;
  } catch (e) {
    console.warn('[CourierAutomation] template lookup failed:', e.message);
    return { ...DEFAULT_TEMPLATES };
  }
}

// Top-and-Tail stitcher: header + dynamic middle + footer, with token fill.
export function stitch(header, middle, footer, vars) {
  return `${fillTemplate(header, vars)}\n\n${(middle || '').trim()}\n\n${fillTemplate(footer, vars)}`;
}

// Normalise a tracking candidate: strip spaces, upper-case, and drop DPD's
// optional leading 1550 prefix so the same parcel reads consistently.
function normalizeTracking(courierCode, raw) {
  if (!raw) return null;
  let t = String(raw).replace(/\s+/g, '').toUpperCase();
  if ((courierCode || '').toLowerCase() === 'dpd') {
    const m = t.match(/^1550(\d{10}[A-Z]?)$/);   // 1550 + 10 digits (+ letter)
    if (m) t = m[1];
  }
  return t || null;
}

// Turn a real sample tracking number into an exact-shape regex: each run of
// digits → \d{n}, each run of letters → [A-Za-z]{n}. So '9753172394' →
// ^\d{10}$ and '1Z999AA10123456784' → ^\d{1}[A-Za-z]{1}\d{3}[A-Za-z]{2}\d{11}$.
export function deriveTrackingRegex(sample) {
  const t = String(sample || '').replace(/\s+/g, '').toUpperCase();
  if (!t) return null;
  const runs = t.match(/(\d+|[A-Z]+|[^0-9A-Z]+)/g) || [];
  let out = '^';
  for (const run of runs) {
    if (/^\d+$/.test(run))        out += `\\d{${run.length}}`;
    else if (/^[A-Z]+$/.test(run)) out += `[A-Za-z]{${run.length}}`;
    else out += run.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');   // literal separator
  }
  return out + '$';
}

// All accepted patterns for a courier: derived from its sample(s), plus any
// manual override pattern. Samples are normalised first (DPD 1550 handling).
async function getCourierTrackingRegexes(courierCode) {
  const code = (courierCode || '').toLowerCase();
  try {
    const r = await query(
      `SELECT tracking_samples, tracking_pattern FROM courier_routing_rules WHERE courier_code = $1 LIMIT 1`,
      [code],
    );
    const row = r.rows[0] || {};
    const samples = String(row.tracking_samples || '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    const regexes = samples
      .map(s => deriveTrackingRegex(normalizeTracking(courierCode, s)))
      .filter(Boolean);
    if (row.tracking_pattern) regexes.push(row.tracking_pattern);
    return regexes;
  } catch (e) {
    console.warn('[CourierAutomation] tracking rule lookup failed:', e.message);
    return [];
  }
}

// Build a per-courier list of real sample tracking numbers (from Settings) to
// feed into the Gemini triage prompt as the authoritative format guide.
export async function getAllTrackingExamples() {
  try {
    const r = await query(
      `SELECT courier_name, courier_code, tracking_samples
         FROM courier_routing_rules
        WHERE courier_code <> 'default'
          AND tracking_samples IS NOT NULL AND btrim(tracking_samples) <> ''`,
    );
    return r.rows.map(row => {
      const samples = String(row.tracking_samples).split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).join(', ');
      return `- ${row.courier_name || row.courier_code}: ${samples}`;
    }).join('\n');
  } catch (e) {
    console.warn('[CourierAutomation] tracking examples fetch failed:', e.message);
    return '';
  }
}

// Identify which courier a tracking number belongs to, purely from its shape —
// so AGL-sourced parcels resolve to Evri or Yodel (we never surface AGL). Returns
// { courier_code, courier_name } or null when no courier's samples match.
export async function identifyCourierByTracking(candidate) {
  if (!candidate) return null;
  try {
    const r = await query(
      `SELECT courier_code, courier_name, tracking_samples, tracking_pattern
         FROM courier_routing_rules
        WHERE is_active = true AND courier_code <> 'default'`,
    );
    for (const row of r.rows) {
      const norm = normalizeTracking(row.courier_code, candidate);
      if (!norm) continue;
      const regexes = String(row.tracking_samples || '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)
        .map(s => deriveTrackingRegex(normalizeTracking(row.courier_code, s))).filter(Boolean);
      if (row.tracking_pattern) regexes.push(row.tracking_pattern);
      for (const p of regexes) {
        try { if (new RegExp(p, 'i').test(norm)) return { courier_code: row.courier_code, courier_name: row.courier_name }; }
        catch { /* skip bad regex */ }
      }
    }
  } catch (e) {
    console.warn('[CourierAutomation] courier identify failed:', e.message);
  }
  return null;
}

// Validate a candidate against the courier's sample-derived shapes (falling back
// to the generic guard when none are configured). Returns the normalised value.
async function resolveTracking(courierCode, candidate) {
  const norm = normalizeTracking(courierCode, candidate);
  if (!norm) return null;
  const regexes = await getCourierTrackingRegexes(courierCode);
  if (regexes.length) {
    for (const p of regexes) {
      try { if (new RegExp(p, 'i').test(norm)) return norm; } catch { /* skip bad regex */ }
    }
    return null;   // shapes are defined but none matched → not a valid ref
  }
  return isLikelyTracking(norm) ? norm : null;
}

// Resolve the live outbound courier address from courier_routing_rules.
// Picks the claims inbox for claim-type issues, else the general queries inbox.
// Falls back to the general address, then null, so drafting never blocks.
async function resolveCourierEmail(courierCode, issueType) {
  if (!courierCode) return null;
  try {
    const r = await query(
      `SELECT queries_email, claims_email
         FROM courier_routing_rules
        WHERE courier_code = $1 AND is_active = true
        LIMIT 1`,
      [courierCode.toLowerCase()],
    );
    if (!r.rows.length) return null;
    const row = r.rows[0];
    return CLAIM_ISSUES.has(issueType)
      ? (row.claims_email || row.queries_email)
      : (row.queries_email || row.claims_email);
  } catch (e) {
    console.warn('[CourierAutomation] routing lookup failed:', e.message);
    return null;
  }
}

// Triage a customer email → draft customer confirmation + courier inquiry → set SLA.
export async function processCustomerEmail(queryId, { subject = '', body = '' } = {}) {
  const tRes = await query(
    `SELECT id, customer_name, courier_code, courier_name, consignment_number, subject
       FROM queries WHERE id = $1`,
    [queryId],
  );
  if (!tRes.rows.length) return { status: 'error', reason: 'ticket not found' };
  const ticket = tRes.rows[0];

  const trackingExamples = await getAllTrackingExamples();
  const triage = await extractTriage(subject || ticket.subject, body, { trackingExamples });

  // ── Acknowledgement filter ──────────────────────────────────────────────────
  // Automated receipts / 'do not reply' noise need no response. Close the loop
  // autonomously, bump the autopilot tally, and create NO drafts.
  if (triage.requires_reply === false) {
    await query(
      `UPDATE queries
          SET internal_automation_state = 'completed_autopilot',
              updated_at = NOW()
        WHERE id = $1`,
      [queryId],
    );
    return { status: 'autopilot_completed', reason: 'no reply required (automated/non-actionable)', triage };
  }

  // Resolve courier — never surface AGL (the wholesaler we buy Evri/Yodel from).
  // Strip it, then let the tracking-number shape decide Evri vs Yodel.
  let courierCode = String(triage.courier_code || ticket.courier_code || '').toLowerCase();
  if (courierCode === 'agl') courierCode = '';
  if (!courierCode) {
    const id = await identifyCourierByTracking(ticket.consignment_number || triage.tracking_code);
    if (id) courierCode = id.courier_code;
  }
  const template = courierCode ? matchTemplate(courierCode, triage.issue_type) : null;

  // Persist the resolved courier so the ticket shows Evri/Yodel (never AGL/blank).
  if (template) {
    await query(
      `UPDATE queries SET courier_code = $2, courier_name = $3, updated_at = NOW() WHERE id = $1`,
      [queryId, courierCode, template.courierName],
    );
  }

  const tpl = await getCourierTemplates(courierCode);
  const vars = {
    customer_name: ticket.customer_name || 'there',
    courier_name:  template?.courierName || ticket.courier_name || 'the courier',
    tracking_code: null,
  };

  // Validate the parcel reference against the courier's real format (with DPD
  // 1550 normalisation) — never fabricate one (e.g. a phone number / word).
  const tracking = await resolveTracking(courierCode, ticket.consignment_number)
                || await resolveTracking(courierCode, triage.tracking_code);
  vars.tracking_code = tracking;

  // ── Ticket-closure pivot ────────────────────────────────────────────────────
  // Customer is just confirming resolution / saying thanks → NO outbound draft.
  // Flag it as an AI-suggested closure; the dashboard intercepts and a human
  // one-click resolves it (no email sent).
  if (triage.intent === 'ticket_closure') {
    await query(
      `UPDATE queries
          SET internal_automation_state = 'suggested_closure',
              triage_intent = 'ticket_closure',
              missing_variables = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [queryId],
    );
    return { status: 'closure_suggested', triage };
  }

  // ── Generalised Information-Gathering branch ────────────────────────────────
  // Missing context = Gemini flagged a gap, OR we'd need to chase a courier but
  // have no valid parcel reference. Either way → ask the customer, suppress the
  // courier inquiry, and record exactly what's missing for the UI.
  const missing = new Set(triage.missing_variables || []);
  if (!tracking && template) missing.add('tracking_number');   // can't chase without it
  const needsContext = triage.has_required_context === false || missing.size > 0;

  if (needsContext) {
    const missingList = [...missing];
    const friendly = missingList.map(v => v.replace(/_/g, ' ')).join(', ');
    const clarMiddle = triage.contextual_clarification_draft
      || `Thanks for getting in touch. So we can take this forward, could you please confirm ` +
         `${friendly || 'a few outstanding details'}? As soon as we have that we'll progress this straight away.`;
    const clarBody = stitch(tpl.customer_header_template, clarMiddle, tpl.customer_footer_template, vars);
    await insertDraft(queryId, 'outbound_customer', `Re: ${ticket.subject || 'your enquiry'}`, clarBody);
    await query(
      `UPDATE queries
          SET internal_automation_state = 'awaiting_customer',
              status = 'awaiting_customer_info'::query_status,
              missing_variables = $2,
              triage_intent = $3,
              updated_at = NOW()
        WHERE id = $1`,
      [queryId, missingList.join(', ') || null, triage.intent || 'information_request'],
    );
    return { status: 'clarification_requested', missing: missingList, triage };
  }

  // We have full context → escalating to a courier needs a matched template.
  if (triage.needs_human || !template) {
    await query(
      `UPDATE queries
          SET internal_automation_state = 'action_required',
              requires_attention = true,
              attention_reason = $2,
              updated_at = NOW()
        WHERE id = $1`,
      [queryId, triage.reason || 'Automation could not match a courier rule — human review needed.'],
    );
    return { status: 'needs_human', triage };
  }

  // Live routing — resolve the real courier inbox.
  const courierEmail = await resolveCourierEmail(courierCode, triage.issue_type);

  // Courier inquiry — header + concise (greeting-free) middle ask + footer.
  const issueLabel = (triage.issue_type || 'GENERAL').replace(/_/g, ' ').toLowerCase();
  const courierMiddle =
    `Please could you assist with consignment ${vars.tracking_code} regarding a ${issueLabel} issue ` +
    `for our customer ${vars.customer_name}? Please investigate and confirm the current status and next steps.`;
  const courierBody = stitch(tpl.courier_header_template, courierMiddle, tpl.courier_footer_template, vars);

  // Customer confirmation — header + greeting-free middle ack + footer.
  const customerMiddle =
    `Thanks for getting in touch about ${issueLabel} on ${vars.tracking_code}. ` +
    `We've raised this with ${vars.courier_name} and are chasing an update on your behalf — ` +
    `we'll come straight back to you as soon as we hear.`;
  const customerBody = stitch(tpl.customer_header_template, customerMiddle, tpl.customer_footer_template, vars);

  // Sandbox: create drafts only — nothing leaves the building.
  await insertDraft(queryId, 'outbound_customer',
    `Re: ${ticket.subject || 'your enquiry'}`,
    customerBody);
  await insertDraft(queryId, 'outbound_courier',
    `${template.courierName} — ${triage.issue_type} — ${vars.tracking_code}`,
    courierBody,
    courierEmail);

  const expiresAt = new Date(Date.now() + (template.slaHours || DEFAULT_SLA_HOURS) * 3600 * 1000);
  await query(
    `UPDATE queries
        SET internal_automation_state = 'awaiting_courier_response',
            courier_sla_expires_at = $2,
            courier_code = COALESCE(courier_code, $3),
            missing_variables = NULL,
            triage_intent = 'courier_chase',
            updated_at = NOW()
      WHERE id = $1`,
    [queryId, expiresAt, courierCode],
  );

  return {
    status: 'drafted',
    triage,
    courier: template.courierName,
    issue_type: triage.issue_type,
    sla_expires_at: expiresAt,
  };
}

// A courier reply arrived on the thread → record it, then run the autonomous
// "Courier Jargon Translation" loop: Gemini rewrites the dry/technical courier
// update into a clear, reassuring customer-facing draft, which lands in the
// Autopilot QA Bay for one-click approval.
// Middle-only: header/footer come from the courier's Top-and-Tail templates, so
// Gemini must NOT add its own greeting or sign-off — just the clear explanation.
const TRANSLATION_SYSTEM =
  'You are a customer success translation engine. Read this dry, technical, or ' +
  'internal logistics update from a courier, strip out internal jargon/codes, and ' +
  'write a polite, completely clear, reassuring explanation for the final customer ' +
  'of what is happening to their parcel. IMPORTANT: do NOT include any greeting ' +
  '(no "Hi"/"Dear") or sign-off — output ONLY the middle body paragraph(s).';

// Translate an already-recorded courier update into a customer-facing draft on
// the SAME ticket — so the reply routes back to the original customer, never to
// the courier. Used by the simulator AND live ingest (Gmail courier replies).
export async function draftCustomerUpdateFromCourier(queryId, body) {
  let translated = null;
  try {
    translated = await geminiGenerate(body, { system: TRANSLATION_SYSTEM, maxTokens: 700, temperature: 0.4 });
  } catch (e) {
    console.warn('[CourierAutomation] translation failed:', e.message);
  }

  if (translated && translated.trim()) {
    const tRes = await query(`SELECT subject, customer_name, courier_code FROM queries WHERE id = $1`, [queryId]);
    const t    = tRes.rows[0] || {};
    const subj = t.subject ? `Re: ${t.subject}` : 'Update on your parcel';
    const tpl  = await getCourierTemplates(t.courier_code);
    const vars = { customer_name: t.customer_name || 'there' };
    const finalOutboundEmail = stitch(tpl.customer_header_template, translated.trim(), tpl.customer_footer_template, vars);

    await insertDraft(queryId, 'outbound_customer', subj, finalOutboundEmail);
    await query(
      `UPDATE queries SET internal_automation_state = 'awaiting_courier_response', updated_at = NOW() WHERE id = $1`,
      [queryId],
    );
    return { status: 'translated_draft_created' };
  }

  // No translation (no key / failure) → hand back to a human.
  await query(
    `UPDATE queries SET internal_automation_state = 'action_required', requires_attention = true, updated_at = NOW() WHERE id = $1`,
    [queryId],
  );
  return { status: 'courier_reply_recorded' };
}

export async function recordCourierReply(queryId, { subject = '', body = '', from = '' } = {}) {
  await query(
    `INSERT INTO query_emails
       (query_id, direction, subject, body_text, from_address, is_ai_draft, received_at, created_at)
     VALUES ($1, 'inbound_courier'::email_direction, $2, $3, $4, false, NOW(), NOW())`,
    [queryId, subject || 'Courier update', body, from || 'courier@external.invalid'],
  );
  return draftCustomerUpdateFromCourier(queryId, body);
}
