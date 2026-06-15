/**
 * Cloud9 OS — Notification service
 *
 * Single helper used by webhook handlers to drop an entry into the central
 * Notification Center. Notifications also surface on the customer record
 * (queried by customer_id) — there is no separate write for that.
 */

import { query } from '../db/index.js';

/**
 * @param {object} n
 * @param {string} n.type      notification_type enum value
 * @param {string} [n.severity] 'green' | 'amber' | 'red' (default 'green')
 * @param {string} [n.customer_id]
 * @param {string} [n.customer_name]
 * @param {string} n.title
 * @param {string} [n.body]
 * @param {string} [n.link_url]
 * @param {string} [n.source_event]
 * @param {object} [n.payload]
 */
export async function createNotification(n) {
  const { rows } = await query(
    `INSERT INTO notifications
       (type, severity, customer_id, customer_name, title, body, link_url, source_event, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      n.type,
      n.severity || 'green',
      n.customer_id || null,
      n.customer_name || null,
      n.title,
      n.body || null,
      n.link_url || null,
      n.source_event || null,
      n.payload ? JSON.stringify(n.payload) : null,
    ]
  );
  return rows[0];
}

/** Resolve a Helm/account reference to a Cloud9 customer row, or null. */
export async function resolveCustomer(ref) {
  if (!ref) return null;
  const { rows } = await query(
    `SELECT id, business_name FROM customers
     WHERE account_number = $1 OR helm_customer_id = $1 LIMIT 1`,
    [String(ref)]
  );
  return rows[0] || null;
}
