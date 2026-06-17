/**
 * learningEngine.js — Autonomous preference learning.
 *
 * When a supervisor refines/edits a draft, this runs in the background: it asks
 * an LLM to abstract the underlying reusable business rule from the correction,
 * commits it to learned_behaviors automatically (no human confirmation), then
 * records a learning_nudge if other open tickets match the same scenario — which
 * the dashboard polls to surface a "we learned something" toast.
 *
 * Fire-and-forget: never throws into the request path; failures are logged only.
 */

import { query } from '../db/index.js';
import { geminiGenerate } from './geminiService.js';

const RESOLVED = `('resolved','resolved_claim_approved','resolved_claim_rejected')`;

const ABSTRACT_SYSTEM =
  'You analyse a manual correction a human supervisor made to a draft email and ' +
  'abstract the underlying reusable business rule so it can be applied globally. ' +
  'Output ONLY a single valid JSON object — no prose, no markdown.';

function stripFences(s) {
  return String(s || '').replace(/```json/gi, '').replace(/```/g, '').trim();
}

export async function aiAutonomouslyLearnPreference(queryId, adminInputText) {
  try {
    if (!adminInputText || !adminInputText.trim()) return;
    if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) return; // nothing to abstract with

    const tRes = await query(
      `SELECT courier_code, courier_name, query_type, group_name, subject FROM queries WHERE id = $1`,
      [queryId],
    );
    const t = tRes.rows[0];
    if (!t) return;

    const prompt =
      `Ticket context — Courier: ${t.courier_name || t.courier_code || 'unknown'}; ` +
      `Intent/issue: ${t.query_type || t.group_name || 'general'}.\n\n` +
      `Supervisor correction: "${adminInputText.trim()}"\n\n` +
      `Abstract the underlying business rule so we can apply it globally. Return JSON:\n` +
      `{"scenario_trigger":"snake_case case type e.g. dpd_parcel_returned",` +
      `"core_instruction":"the abstracted styling/process rule"}`;

    let parsed;
    try {
      parsed = JSON.parse(stripFences(await geminiGenerate(prompt, { system: ABSTRACT_SYSTEM, json: true, maxTokens: 300 })));
    } catch (e) {
      console.warn('[Learning] abstraction failed:', e.message);
      return;
    }

    const scenario    = String(parsed.scenario_trigger || '').trim().toLowerCase().replace(/\s+/g, '_');
    const instruction = String(parsed.core_instruction || '').trim();
    if (!scenario || !instruction) return;

    // Auto-commit the abstracted rule to the global brain — no confirmation.
    await query(
      `INSERT INTO learned_behaviors (scenario_trigger, core_instruction, courier_code, issue_type, source_query_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [scenario, instruction, t.courier_code || null, t.query_type || null, queryId],
    );

    // Count OTHER open tickets in the same scenario (same courier + issue) that
    // still have a pending draft we could update.
    const matchRes = await query(
      `SELECT COUNT(DISTINCT q.id)::int AS c
         FROM queries q
         JOIN query_emails qe ON qe.query_id = q.id
          AND qe.is_ai_draft = true AND qe.sent_at IS NULL AND qe.ai_draft_approved_by IS NULL
        WHERE q.id <> $1
          AND q.status NOT IN ${RESOLVED}
          AND q.courier_code IS NOT DISTINCT FROM $2
          AND q.query_type   IS NOT DISTINCT FROM $3`,
      [queryId, t.courier_code || null, t.query_type || null],
    );
    const matchCount = matchRes.rows[0]?.c || 0;

    await query(
      `INSERT INTO learning_nudges (scenario_trigger, core_instruction, courier_code, issue_type, match_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [scenario, instruction, t.courier_code || null, t.query_type || null, matchCount],
    );

    console.log(`[Learning] committed "${scenario}" — ${matchCount} matching open ticket(s)`);
  } catch (e) {
    console.warn('[Learning] aiAutonomouslyLearnPreference error:', e.message);
  }
}
