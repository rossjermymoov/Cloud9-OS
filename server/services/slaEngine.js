/**
 * Moov OS — SLA Trigger Engine (shared)
 *
 * IF (field/operator/value) THEN (set priority + start SLA clock).
 *
 * Run on every newly-created ticket regardless of source (Gmail ingest OR the
 * manual POST /api/queries path) so routing behaviour is identical everywhere.
 * Active triggers are evaluated in descending weight order; the FIRST match
 * wins. A match can override the ticket priority and/or map the SLA resolution
 * clock straight from the linked policy's per-priority target grid (writing both
 * query_sla_assignments and the courier_sla_expires_at field the ticket
 * header/badges read live).
 */

import { query } from '../db/index.js';

export async function applySlaTriggers(queryId, ctx = {}) {
  const { rows: triggers } = await query(`
    SELECT r.*, p.name AS policy_name
    FROM sla_rules r
    LEFT JOIN sla_policies p ON p.id = r.policy_id
    WHERE r.is_active = true
      AND r.condition_field IS NOT NULL
    ORDER BY r.priority DESC, r.created_at ASC
  `);
  if (!triggers.length) return { matched: false };

  const fields = {
    subject:       ctx.subject      || '',
    sender_email:  ctx.senderEmail  || '',
    courier_code:  ctx.courierCode  || '',
    body_text:     ctx.body         || '',
    customer_tier: ctx.customerTier || '',
  };

  for (const t of triggers) {
    const hay    = String(fields[t.condition_field] ?? '').toLowerCase();
    const needle = String(t.match_value || '').toLowerCase();
    if (!needle) continue;

    const op = (t.operator || 'contains').toLowerCase();
    const matched =
      op === 'equals'      ? hay === needle :
      op === 'starts_with' ? hay.startsWith(needle) :
                             hay.includes(needle);
    if (!matched) continue;

    // THEN — override priority
    if (t.set_priority) {
      await query(`UPDATE queries SET priority = $1 WHERE id = $2`, [t.set_priority, queryId]);
    }

    // THEN — start the SLA clock from the linked policy's target for that priority
    if (t.policy_id) {
      const pr  = t.set_priority || 'medium';
      const tgt = await query(
        `SELECT resolution_hours FROM sla_policy_targets WHERE policy_id = $1 AND priority = $2`,
        [t.policy_id, pr]
      );
      const hours = tgt.rows[0]?.resolution_hours;
      if (hours) {
        await query(`
          INSERT INTO query_sla_assignments
            (query_id, policy_id, policy_name, duration_hours, due_at, triggered_by, rule_id)
          VALUES ($1, $2, $3, $4, NOW() + ($4 || ' hours')::INTERVAL, 'rule_match', $5)
        `, [queryId, t.policy_id, t.policy_name || 'SLA Trigger', hours, t.id]);
        await query(
          `UPDATE queries SET courier_sla_expires_at = NOW() + ($1 || ' hours')::INTERVAL WHERE id = $2`,
          [hours, queryId]
        );
      }
    }

    console.log(`[SLA] trigger "${t.name}" matched ticket ${queryId} → priority=${t.set_priority || '—'}, policy=${t.policy_name || '—'}`);
    return { matched: true, rule: t.name, priority: t.set_priority || null };
  }
  return { matched: false, priority: null };
}
