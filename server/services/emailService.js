/**
 * emailService.js — centralised email sending for Moov OS
 *
 * Provider: SendGrid (@sendgrid/mail)
 * Config:   loaded from email_config table (id=1) at call time so changes
 *           take effect without a server restart.
 *
 * Public API
 * ──────────
 * sendEmail(to, subject, html, text?)  — low-level: send one message
 * sendAlert(alertTypeCode, data)        — high-level: resolve recipients from DB,
 *                                         apply cooldown, render and send
 * testConnection(apiKey, fromAddress)   — validate credentials before saving
 */

import { query } from '../db/index.js';

// ─── Load config from DB ──────────────────────────────────────────────────────

async function loadConfig() {
  const res = await query('SELECT * FROM email_config WHERE id = 1');
  return res.rows[0] || null;
}

// ─── Dynamic SendGrid client ──────────────────────────────────────────────────
// We import @sendgrid/mail lazily (via dynamic import) so that the server still
// starts even if the package isn't installed yet — it will just log a warning.

let sgMailModule = null;

async function getSgMail() {
  if (!sgMailModule) {
    try {
      sgMailModule = (await import('@sendgrid/mail')).default;
    } catch {
      throw new Error('@sendgrid/mail is not installed. Run: npm install @sendgrid/mail --prefix server');
    }
  }
  return sgMailModule;
}

// ─── sendEmail ────────────────────────────────────────────────────────────────

export async function sendEmail(to, subject, html, text) {
  const cfg = await loadConfig();

  if (!cfg || !cfg.enabled) {
    console.log(`📧 Email service disabled — would have sent "${subject}" to ${Array.isArray(to) ? to.join(', ') : to}`);
    return { skipped: true, reason: 'email_disabled' };
  }

  if (!cfg.api_key) {
    throw new Error('Email config is enabled but no API key is set');
  }

  const sgMail = await getSgMail();
  sgMail.setApiKey(cfg.api_key);

  const msg = {
    to,
    from: { email: cfg.from_address, name: cfg.from_name },
    subject,
    html,
    ...(text ? { text } : {}),
  };

  await sgMail.send(msg);
  return { sent: true };
}

// ─── testConnection ───────────────────────────────────────────────────────────

export async function testConnection(apiKey, fromAddress, fromName, toAddress) {
  const sgMail = await getSgMail();
  sgMail.setApiKey(apiKey);

  await sgMail.send({
    to:      toAddress,
    from:    { email: fromAddress, name: fromName || 'Moov OS' },
    subject: 'Moov OS — Email test',
    html:    `<p>This is a test email from <strong>Moov OS</strong>. If you received this, your SendGrid integration is working correctly.</p>`,
    text:    'This is a test email from Moov OS. If you received this, your SendGrid integration is working correctly.',
  });

  return { sent: true };
}

// ─── Alert templates ──────────────────────────────────────────────────────────

function renderAlert(code, data) {
  const ts = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'short', timeStyle: 'medium' });

  switch (code) {
    case 'webhook_gap': {
      const mins = Math.round(data.gap_minutes ?? 0);
      return {
        subject: `⚠️ Moov OS — No tracking webhooks for ${mins} minutes`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#1a1a2e;padding:20px 24px;border-radius:8px 8px 0 0">
              <h2 style="color:#ff9800;margin:0">⚠️ Webhook Gap Detected</h2>
            </div>
            <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0">
              <p style="margin:0 0 16px">No tracking webhooks have been received for <strong>${mins} minutes</strong> during UK business hours.</p>
              <table style="width:100%;border-collapse:collapse;font-size:14px">
                <tr><td style="padding:6px 12px;background:#fff;border:1px solid #e0e0e0;font-weight:600;width:40%">Last webhook received</td>
                    <td style="padding:6px 12px;background:#fff;border:1px solid #e0e0e0">${data.last_webhook_at ? new Date(data.last_webhook_at).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : 'Unknown'}</td></tr>
                <tr><td style="padding:6px 12px;background:#f5f5f5;border:1px solid #e0e0e0;font-weight:600">Gap (minutes)</td>
                    <td style="padding:6px 12px;background:#f5f5f5;border:1px solid #e0e0e0">${mins} min</td></tr>
                <tr><td style="padding:6px 12px;background:#fff;border:1px solid #e0e0e0;font-weight:600">Alert time</td>
                    <td style="padding:6px 12px;background:#fff;border:1px solid #e0e0e0">${ts}</td></tr>
              </table>
              <p style="margin:20px 0 0;color:#666;font-size:13px">Check the Voila webhook configuration and use the <strong>Date Range Backfill</strong> in Moov OS Settings → Email to recover any missed shipments.</p>
            </div>
          </div>`,
      };
    }

    case 'backfill_triggered': {
      return {
        subject: `ℹ️ Moov OS — API backfill triggered for ${data.reference || data.consignment}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#1a1a2e;padding:20px 24px;border-radius:8px 8px 0 0">
              <h2 style="color:#2196f3;margin:0">ℹ️ API Backfill Triggered</h2>
            </div>
            <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0">
              <p style="margin:0 0 16px">The Layer 1 Voila API backfill was triggered for a shipment whose creation webhook was missed.</p>
              <table style="width:100%;border-collapse:collapse;font-size:14px">
                <tr><td style="padding:6px 12px;background:#fff;border:1px solid #e0e0e0;font-weight:600;width:40%">Reference</td>
                    <td style="padding:6px 12px;background:#fff;border:1px solid #e0e0e0">${data.reference || '—'}</td></tr>
                <tr><td style="padding:6px 12px;background:#f5f5f5;border:1px solid #e0e0e0;font-weight:600">Consignment</td>
                    <td style="padding:6px 12px;background:#f5f5f5;border:1px solid #e0e0e0">${data.consignment || '—'}</td></tr>
                <tr><td style="padding:6px 12px;background:#fff;border:1px solid #e0e0e0;font-weight:600">Charges created</td>
                    <td style="padding:6px 12px;background:#fff;border:1px solid #e0e0e0">${data.charges_created ?? '—'}</td></tr>
                <tr><td style="padding:6px 12px;background:#f5f5f5;border:1px solid #e0e0e0;font-weight:600">Time</td>
                    <td style="padding:6px 12px;background:#f5f5f5;border:1px solid #e0e0e0">${ts}</td></tr>
              </table>
            </div>
          </div>`,
      };
    }

    case 'billing_run_complete': {
      return {
        subject: `✅ Moov OS — Billing run complete`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#1a1a2e;padding:20px 24px;border-radius:8px 8px 0 0">
              <h2 style="color:#00C853;margin:0">✅ Billing Run Complete</h2>
            </div>
            <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0">
              <table style="width:100%;border-collapse:collapse;font-size:14px">
                <tr><td style="padding:6px 12px;background:#fff;border:1px solid #e0e0e0;font-weight:600;width:50%">Customers processed</td>
                    <td style="padding:6px 12px;background:#fff;border:1px solid #e0e0e0">${data.customers_processed ?? '—'}</td></tr>
                <tr><td style="padding:6px 12px;background:#f5f5f5;border:1px solid #e0e0e0;font-weight:600">Charges queued</td>
                    <td style="padding:6px 12px;background:#f5f5f5;border:1px solid #e0e0e0">${data.charges_queued ?? '—'}</td></tr>
                <tr><td style="padding:6px 12px;background:#fff;border:1px solid #e0e0e0;font-weight:600">Run time</td>
                    <td style="padding:6px 12px;background:#fff;border:1px solid #e0e0e0">${ts}</td></tr>
              </table>
            </div>
          </div>`,
      };
    }

    default:
      return {
        subject: `Moov OS — Alert: ${code}`,
        html: `<pre>${JSON.stringify(data, null, 2)}</pre>`,
      };
  }
}

// ─── sendAlert ────────────────────────────────────────────────────────────────

export async function sendAlert(code, data = {}) {
  try {
    // Load alert type
    const typeRes = await query(
      'SELECT * FROM email_alert_types WHERE code = $1',
      [code]
    );
    const alertType = typeRes.rows[0];
    if (!alertType || !alertType.enabled) return;

    // Cooldown check
    const settings = alertType.settings || {};
    const cooldownMins = settings.cooldown_minutes ?? 30;
    if (alertType.last_alerted_at) {
      const msSince = Date.now() - new Date(alertType.last_alerted_at).getTime();
      if (msSince < cooldownMins * 60 * 1000) return;
    }

    // Load recipients
    const recipRes = await query(
      `SELECT email, name FROM email_alert_recipients
       WHERE alert_type_id = $1 AND enabled = true`,
      [alertType.id]
    );
    if (!recipRes.rows.length) return;

    const toList = recipRes.rows.map(r => ({ email: r.email, name: r.name || r.email }));
    const { subject, html } = renderAlert(code, data);

    await sendEmail(toList, subject, html);

    // Update last_alerted_at
    await query(
      'UPDATE email_alert_types SET last_alerted_at = NOW(), updated_at = NOW() WHERE code = $1',
      [code]
    );
  } catch (err) {
    // Never let an alert failure crash the caller
    console.error(`❌ sendAlert(${code}) failed:`, err.message);
  }
}
