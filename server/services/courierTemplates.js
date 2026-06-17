/**
 * courierTemplates.js — Template Matrix
 *
 * Maps each courier to the issue types we automate, and the two messages the
 * loop drafts for each: a confirmation to the customer and a structured inquiry
 * to the courier. Placeholders ({{customer_name}}, {{tracking_code}},
 * {{courier_name}}) are filled at draft time.
 *
 * NOTE: courierEmail values below are PLACEHOLDERS — set the real dispute/claims
 * addresses before enabling live sending. `slaHours` defaults to 24.
 */

export const ISSUE_TYPES = [
  'NO_SCAN_24H',
  'DAMAGED',
  'RETURN_TO_SENDER',
  'FAILED_DELIVERY',
  'LOST',
  'GENERAL',
];

// Shared message builders keep the matrix compact and consistent.
const customerAck = (issueLabel) =>
  `Hi {{customer_name}},\n\n` +
  `Thanks for getting in touch regarding ${issueLabel.toLowerCase()} on {{tracking_code}}. ` +
  `We've raised this with {{courier_name}} and are chasing an update on your behalf — ` +
  `we'll come straight back to you as soon as we hear.\n\n` +
  `Kind regards,\nThe Moov Parcel Team`;

const courierAsk = (issueLabel, ask) =>
  `Hello {{courier_name}} Team,\n\n` +
  `Please can you assist with consignment {{tracking_code}} (${issueLabel}). ${ask}\n\n` +
  `Customer: {{customer_name}}.\n\nMany thanks,\nMoov Parcel`;

const ISSUE_DEFS = {
  NO_SCAN_24H:      { label: 'No scan in 24h',      ask: 'It has not scanned in over 24 hours — please advise its current location and expected delivery date.' },
  DAMAGED:          { label: 'Damaged in transit',  ask: 'The item has arrived damaged — please open a damage claim and confirm next steps and any evidence required.' },
  RETURN_TO_SENDER: { label: 'Return to sender',    ask: 'The parcel is showing as return to sender — please confirm the reason and whether it can be re-delivered.' },
  FAILED_DELIVERY:  { label: 'Failed delivery',     ask: 'Delivery has failed — please confirm the reason and arrange a re-attempt.' },
  LOST:             { label: 'Lost parcel',         ask: 'The parcel appears to be lost — please open a lost-in-transit investigation and confirm the claim window.' },
  GENERAL:          { label: 'General query',       ask: 'Please review and provide a status update at your earliest convenience.' },
};

// Build the per-issue template block for a courier.
const issueBlock = (only) => {
  const out = {};
  for (const key of (only || ISSUE_TYPES)) {
    const def = ISSUE_DEFS[key] || ISSUE_DEFS.GENERAL;
    out[key] = {
      slaHours: 24,
      customerConfirmation: customerAck(def.label),
      courierInquiry: courierAsk(def.label, def.ask),
    };
  }
  return out;
};

// ── Courier Rules Matrix ─────────────────────────────────────────────────────
export const COURIER_RULES = {
  dpd:   { name: 'DPD',   courierEmail: 'TODO-dpd-disputes@example.com',  issues: issueBlock() },
  dhl:   { name: 'DHL',   courierEmail: 'TODO-dhl-claims@example.com',    issues: issueBlock() },
  evri:      { name: 'Evri',      courierEmail: 'TODO-evri-support@example.com',  issues: issueBlock() },
  yodel:     { name: 'Yodel',     courierEmail: 'TODO-yodel-support@example.com', issues: issueBlock() },
  yodel_c2c: { name: 'Yodel C2C', courierEmail: 'TODO-yodel-c2c@example.com',     issues: issueBlock() },
};

// Resolve a template for a courier + issue type, with safe fallbacks so the loop
// always has something to draft.
export function matchTemplate(courierCode, issueType) {
  const code = (courierCode || '').toLowerCase();
  const rule = COURIER_RULES[code];
  if (!rule) return null;                              // unknown courier → needs a human
  const issue = rule.issues[issueType] || rule.issues.GENERAL;
  return {
    courierName:  rule.name,
    courierEmail: rule.courierEmail,
    issueType:    rule.issues[issueType] ? issueType : 'GENERAL',
    ...issue,
  };
}

// Fill {{placeholders}} in a template string.
export function fillTemplate(text, vars) {
  return (text || '').replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}
