/**
 * Cloud9 OS — Customer Management API
 * Customer model copied from Moov OS; trimmed to the Phase 0 schema and
 * extended with the per-customer notification thread + purchase orders.
 */

import express from 'express';
import { query } from '../db/index.js';

const router = express.Router();

const ALLOWED_SORT = ['business_name', 'account_number', 'tier', 'account_status',
  'health_score', 'date_onboarded', 'outstanding_balance', 'credit_limit'];

// ─── GET /api/customers ──────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { search, status, tier, health_score, sort = 'business_name', order = 'asc', limit = 50, offset = 0 } = req.query;
    const col = ALLOWED_SORT.includes(sort) ? sort : 'business_name';
    const dir = order === 'desc' ? 'DESC' : 'ASC';

    const conditions = [];
    const values = [];
    let idx = 1;
    if (search) {
      conditions.push(`(c.business_name ILIKE $${idx} OR c.account_number ILIKE $${idx} OR c.primary_email ILIKE $${idx} OR c.postcode ILIKE $${idx})`);
      values.push(`%${search}%`); idx++;
    }
    if (status)       { conditions.push(`c.account_status = $${idx++}`); values.push(status); }
    if (tier)         { conditions.push(`c.tier = $${idx++}`);           values.push(tier); }
    if (health_score) { conditions.push(`c.health_score = $${idx++}`);   values.push(health_score); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows, countResult] = await Promise.all([
      query(`
        SELECT c.id, c.account_number, c.helm_accounts_id, c.helm_customer_id,
               c.business_name, c.primary_email, c.accounts_email, c.phone_number,
               c.postcode, c.city, c.county, c.country, c.tier, c.account_status,
               c.health_score, c.is_on_stop, c.outstanding_balance, c.credit_limit,
               c.billing_cycle, c.payment_terms_days, c.date_onboarded,
               am.full_name AS account_manager_name
        FROM customers c
        LEFT JOIN staff am ON am.id = c.account_manager_id
        ${where}
        ORDER BY c.${col} ${dir}
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...values, parseInt(limit), parseInt(offset)]),
      query(`SELECT COUNT(*)::int AS count FROM customers c ${where}`, values),
    ]);

    res.json({ data: rows.rows, total: countResult.rows[0].count, limit: parseInt(limit), offset: parseInt(offset) });
  } catch (err) { next(err); }
});

// ─── GET /api/customers/:id ──────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const [customerRes, contactsRes, volumeRes, notifsRes, poRes] = await Promise.all([
      query(`
        SELECT c.*, am.full_name AS account_manager_name, sp.full_name AS salesperson_name
        FROM customers c
        LEFT JOIN staff am ON am.id = c.account_manager_id
        LEFT JOIN staff sp ON sp.id = c.salesperson_id
        WHERE c.id = $1`, [id]),
      query(`SELECT * FROM customer_contacts WHERE customer_id = $1 ORDER BY is_main_contact DESC, full_name`, [id]),
      query(`SELECT snapshot_date, parcel_count, item_count, revenue
             FROM customer_volume_snapshots WHERE customer_id = $1 AND snapshot_date >= NOW() - INTERVAL '90 days'
             ORDER BY snapshot_date DESC`, [id]),
      query(`SELECT * FROM notifications WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50`, [id]),
      query(`SELECT id, po_number, status, expected_date, total_lines, total_units, created_at
             FROM purchase_orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20`, [id]),
    ]);

    if (!customerRes.rows.length) return res.status(404).json({ error: 'Customer not found' });

    res.json({
      customer:         customerRes.rows[0],
      contacts:         contactsRes.rows,
      volume_snapshots: volumeRes.rows,
      notifications:    notifsRes.rows,
      purchase_orders:  poRes.rows,
    });
  } catch (err) { next(err); }
});

// ─── GET /api/customers/:id/notifications ────────────────────────────────────
router.get('/:id/notifications', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM notifications WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── POST /api/customers ─────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.business_name) return res.status(400).json({ error: 'business_name is required' });

    const result = await query(`
      INSERT INTO customers
        (business_name, helm_customer_id, address_line_1, address_line_2, city, county, postcode, country,
         phone_number, primary_email, accounts_email, company_type, company_reg_number, vat_number,
         tier, payment_terms_days, billing_cycle, credit_limit, account_number)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      RETURNING *
    `, [
      b.business_name, b.helm_customer_id || null,
      b.address_line_1 || null, b.address_line_2 || null, b.city || null, b.county || null,
      b.postcode || null, b.country || 'United Kingdom',
      b.phone_number || null, b.primary_email || null, b.accounts_email || null,
      b.company_type || null, b.company_reg_number || null, b.vat_number || null,
      b.tier || 'bronze', b.payment_terms_days || 30, b.billing_cycle || 'monthly',
      b.credit_limit || 0, b.account_number || null,
    ]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A customer with these details already exists' });
    next(err);
  }
});

// ─── PATCH /api/customers/:id ────────────────────────────────────────────────
router.patch('/:id', async (req, res, next) => {
  try {
    const allowed = ['business_name','address_line_1','address_line_2','city','county','postcode','country',
      'phone_number','primary_email','accounts_email','company_type','company_reg_number','vat_number',
      'tier','account_status','payment_terms_days','billing_cycle','credit_limit',
      'salesperson_id','account_manager_id','onboarding_person_id'];
    const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
    if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });

    const setClauses = updates.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    const values = [req.params.id, ...updates.map(([, v]) => v)];
    const result = await query(`UPDATE customers SET ${setClauses} WHERE id = $1 RETURNING *`, values);
    if (!result.rows.length) return res.status(404).json({ error: 'Customer not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ─── Contacts ────────────────────────────────────────────────────────────────
router.get('/:id/contacts', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT * FROM customer_contacts WHERE customer_id = $1 ORDER BY is_main_contact DESC, full_name',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/:id/contacts', async (req, res, next) => {
  try {
    const { full_name, job_title, phone_number, email_address, is_main_contact, is_finance_contact } = req.body;
    if (!full_name || !email_address) return res.status(400).json({ error: 'full_name and email_address are required' });
    if (is_main_contact)    await query('UPDATE customer_contacts SET is_main_contact = false WHERE customer_id = $1', [req.params.id]);
    if (is_finance_contact) await query('UPDATE customer_contacts SET is_finance_contact = false WHERE customer_id = $1', [req.params.id]);
    const { rows } = await query(
      `INSERT INTO customer_contacts (customer_id, full_name, job_title, phone_number, email_address, is_main_contact, is_finance_contact)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, full_name, job_title || null, phone_number || null, email_address, is_main_contact || false, is_finance_contact || false]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ─── On-stop ─────────────────────────────────────────────────────────────────
router.post('/:id/on-stop', async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    const updated = await query(`
      UPDATE customers SET is_on_stop = true, account_status = 'on_stop',
             on_stop_reason = $2, on_stop_applied_at = NOW()
      WHERE id = $1 AND is_on_stop = false RETURNING *`, [req.params.id, reason]);
    if (!updated.rows.length) return res.status(409).json({ error: 'Customer is already on stop or not found' });
    await query(`INSERT INTO customer_on_stop_log (customer_id, action, reason) VALUES ($1,'applied',$2)`, [req.params.id, reason]);
    res.json({ success: true, customer: updated.rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:id/on-stop', async (req, res, next) => {
  try {
    const { note } = req.body;
    if (!note) return res.status(400).json({ error: 'note is required' });
    const updated = await query(`
      UPDATE customers SET is_on_stop = false, account_status = 'active',
             on_stop_reason = NULL, on_stop_applied_at = NULL
      WHERE id = $1 AND is_on_stop = true RETURNING *`, [req.params.id]);
    if (!updated.rows.length) return res.status(409).json({ error: 'Customer is not on stop or not found' });
    await query(`INSERT INTO customer_on_stop_log (customer_id, action, reason) VALUES ($1,'removed',$2)`, [req.params.id, note]);
    res.json({ success: true, customer: updated.rows[0] });
  } catch (err) { next(err); }
});

export default router;
