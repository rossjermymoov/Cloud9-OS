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
 * @param {string} [n.ref]   external reference (e.g. consignment number) used to
 *                           auto-resolve the alert later. See resolveNotifications.
 */
export async function createNotification(n) {
  const { rows } = await query(
    `INSERT INTO notifications
       (type, severity, customer_id, customer_name, title, body, link_url, source_event, payload, ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
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
      n.ref || null,
    ]
  );
  return rows[0];
}

/**
 * Mark open notifications of a given type + ref as resolved. Used when a
 * tracking parcel moves out of an exception state, so its stale alert drops
 * out of the live feed. Returns the number resolved.
 */
export async function resolveNotifications({ type, ref }) {
  if (!type || !ref) return 0;
  const { rows } = await query(
    `UPDATE notifications SET resolved_at = NOW()
      WHERE type = $1::notification_type AND ref = $2 AND resolved_at IS NULL
      RETURNING id`,
    [type, String(ref)]
  );
  return rows.length;
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
