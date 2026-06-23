/**
 * slaMonitor.js — "Screaming" SLA escalation to Google Chat (#cs-alerts).
 *
 * Scans open tickets whose courier SLA clock has blown and that haven't yet been
 * escalated, then posts a rich cardsV2 alert to the Google Chat incoming webhook
 * (GOOGLE_CHAT_WEBHOOK_URL). Marks google_chat_escalated so each ticket screams
 * once. The UI separately shifts the card red via courier_sla_breached.
 *
 * No-ops cleanly when the webhook env var is absent.
 */

import { query } from '../db/index.js';

const RESOLVED = `('resolved','resolved_claim_approved','resolved_claim_rejected')`;
const APP_BASE = process.env.PUBLIC_APP_URL || 'https://moovos-production.up.railway.app';

function fmtSince(ts) {
  if (!ts) return 'unknown';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function buildCard(t) {
  const since = fmtSince(t.courier_sla_expires_at);
  return {
    cardsV2: [{
      cardId: `moov-sla-breach-${t.ticket_number}`,
      card: {
        header: {
          title: `⏳ SLA BREACH — Moov-${t.ticket_number}`,
          subtitle: `${t.courier_name || 'Courier'} · Awaiting reply ${since} past SLA`,
        },
        sections: [
          {
            header: 'Ticket summary',
            widgets: [
              { decoratedText: { topLabel: 'Customer',    text: t.customer_name || '—' } },
              { decoratedText: { topLabel: 'Consignment', text: t.consignment_number || '—' } },
              { decoratedText: { topLabel: 'Priority',    text: String(t.priority || 'medium').toUpperCase() } },
              { textParagraph: { text: `<b>Summary:</b> ${(t.description || 'No summary.').slice(0, 400)}` } },
              { decoratedText: { startIcon: { knownIcon: 'CLOCK' }, text: `Stagnant for <b>${since}</b> past the SLA window.` } },
            ],
          },
          {
            widgets: [{
              buttonList: { buttons: [
                { text: '🔄 Fire Auto-Remind Email',
                  onClick: { openLink: { url: `${APP_BASE}/api/queries/${t.id}/auto-remind` } } },
                { text: 'Open Ticket',
                  onClick: { openLink: { url: `${APP_BASE}/queries/${t.id}` } } },
              ]},
            }],
          },
        ],
      },
    }],
  };
}

export async function runSlaScreamScan() {
  const webhook = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (!webhook) return { skipped: 'no GOOGLE_CHAT_WEBHOOK_URL' };

  const due = await query(`
    SELECT id, ticket_number, customer_name, courier_name, consignment_number,
           priority, description, courier_sla_expires_at
    FROM queries
    WHERE courier_sla_expires_at IS NOT NULL
      AND courier_sla_expires_at < NOW()
      AND COALESCE(google_chat_escalated, false) = false
      AND status NOT IN ${RESOLVED}
    ORDER BY courier_sla_expires_at ASC
    LIMIT 20
  `);

  let screamed = 0;
  for (const t of due.rows) {
    try {
      const resp = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildCard(t)),
      });
      if (resp.ok) {
        await query(`UPDATE queries SET google_chat_escalated = true, updated_at = NOW() WHERE id = $1`, [t.id]);
        screamed++;
      } else {
        console.warn('[SLA] Google Chat post failed:', resp.status, await resp.text());
      }
    } catch (e) { console.warn('[SLA] Google Chat error:', e.message); }
  }
  if (screamed) console.log(`[SLA] 🔔 screamed ${screamed} breached ticket(s) to Google Chat`);
  return { screamed, scanned: due.rows.length };
}
