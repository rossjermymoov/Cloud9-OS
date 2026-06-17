/**
 * Moov OS — Hybrid Priority Triage Engine
 *
 * Two-phase grading, run on ticket creation and by the historical backfill:
 *
 *   PHASE 1 — Hard rules: deterministic keyword scan of subject + body. A match
 *             (e.g. "P1", "urgent", "critical") forces priority = 'urgent'
 *             immediately, no AI call.
 *   PHASE 2 — Gemini grader: when no hard rule fires, Gemini 1.5 Flash acts as an
 *             expert logistics triager and grades emotional urgency, operational
 *             bottleneck and transit impact, returning High / Medium / Low.
 *
 * Output is always a lowercase ticket_priority enum value (urgent|high|medium|low),
 * so it can be written straight to queries.priority. Never throws — falls back to
 * 'medium' if the AI call fails or no key is configured.
 */

import { geminiGenerate } from './geminiService.js';

// PHASE 1 — hard rules. First match wins; all force 'urgent'.
const HARD_RULES = [
  /\bP1\b/i,
  /\b(urgent|critical|emergency|asap|immediately)\b/i,
  /\b(escalat\w+)\b/i,
];

function hardRuleMatch(text) {
  return HARD_RULES.some(re => re.test(text));
}

// PHASE 2 — Gemini grader → 'high' | 'medium' | 'low'
async function gradeWithGemini(subject, body) {
  const prompt =
    `You are an expert logistics support triager for a parcel-delivery reseller.\n` +
    `Grade the URGENCY of the customer email below. Weigh three dimensions:\n` +
    `  1. emotional_urgency  — how distressed / angry / time-pressured the customer is.\n` +
    `  2. operational_bottleneck — how much this blocks our operations or a shipment.\n` +
    `  3. transit_impact     — risk to the parcel (lost, damaged, stuck, time-critical).\n\n` +
    `Return STRICT JSON only with keys:\n` +
    `  emotional_urgency, operational_bottleneck, transit_impact, priority\n` +
    `Each of the first three is one of "High","Medium","Low".\n` +
    `"priority" is your overall grade and MUST be exactly one of "High","Medium","Low".\n\n` +
    `Subject: ${subject || '(none)'}\n` +
    `Body: ${(body || '').slice(0, 3000)}`;

  const raw = await geminiGenerate(prompt, { json: true, temperature: 0, maxTokens: 300 });
  const parsed = JSON.parse(raw);
  const grade = String(parsed.priority || '').toLowerCase();
  return ['high', 'medium', 'low'].includes(grade) ? grade : 'medium';
}

/**
 * Grade a single ticket's priority.
 * @returns {Promise<{ priority: 'urgent'|'high'|'medium'|'low', source: string }>}
 */
export async function triagePriority({ subject = '', body = '' } = {}) {
  const text = `${subject}\n${body}`;

  // PHASE 1 — hard rules
  if (hardRuleMatch(text)) return { priority: 'urgent', source: 'hard_rule' };

  // PHASE 2 — Gemini grader (graceful fallback to medium)
  try {
    const grade = await gradeWithGemini(subject, body);
    return { priority: grade, source: 'ai_grader' };
  } catch (e) {
    console.warn('[Triage] Gemini grader failed, defaulting to medium:', e.message);
    return { priority: 'medium', source: 'fallback' };
  }
}
