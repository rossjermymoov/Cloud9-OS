/**
 * Cloud9 OS — Authentication & user management
 *
 * First run: no users exist → /setup-status returns needs_setup, and /setup
 * creates the first admin (allowed only while there are zero users).
 * Thereafter: /login issues a JWT; data routes require a valid token via
 * `requireAuth`. Everyone has full access for now (is_admin reserved for later).
 * Passwords are bcrypt-hashed; the secret is JWT_SECRET (set it in Railway).
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db/index.js';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'cloud9-dev-secret-change-me';
const TOKEN_TTL = '30d';
if (!process.env.JWT_SECRET) console.warn('⚠️  JWT_SECRET not set — using a dev fallback. Set JWT_SECRET in Railway.');

const publicUser = (u) => ({ id: u.id, email: u.email, full_name: u.full_name, is_admin: u.is_admin, active: u.active });
const signToken = (u) => jwt.sign({ sub: u.id, email: u.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || ''));

async function userCount() {
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM app_users`);
  return rows[0].n;
}

// ─── Auth middleware (mounted on protected routers by index.js) ──────────────
export async function requireAuth(req, res, next) {
  try {
    // While no users exist the app is in first-run setup — allow through so the
    // setup screen can load; everything meaningful still needs a token once set up.
    if (await userCount() === 0) return next();
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); }
    catch { return res.status(401).json({ error: 'Invalid or expired session' }); }
    const { rows } = await query(`SELECT id, email, full_name, is_admin, active FROM app_users WHERE id = $1`, [payload.sub]);
    if (!rows[0] || !rows[0].active) return res.status(401).json({ error: 'Account not found or disabled' });
    req.user = rows[0];
    next();
  } catch (err) { next(err); }
}

// ─── Public: setup state + first-admin creation + login ──────────────────────
router.get('/setup-status', async (_req, res, next) => {
  try { res.json({ needs_setup: (await userCount()) === 0 }); }
  catch (err) { next(err); }
});

router.post('/setup', async (req, res, next) => {
  try {
    if (await userCount() > 0) return res.status(409).json({ error: 'Setup already complete — ask an admin to invite you.' });
    const { full_name, email, password } = req.body || {};
    if (!validEmail(email)) return res.status(400).json({ error: 'A valid email is required' });
    if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hash = await bcrypt.hash(String(password), 10);
    const { rows } = await query(
      `INSERT INTO app_users (email, full_name, password_hash, is_admin) VALUES ($1,$2,$3,true)
       RETURNING id, email, full_name, is_admin, active`,
      [String(email).trim(), full_name || null, hash]
    );
    res.json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
  } catch (err) { next(err); }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const { rows } = await query(`SELECT * FROM app_users WHERE LOWER(email) = LOWER($1)`, [String(email).trim()]);
    const u = rows[0];
    const okHash = u ? await bcrypt.compare(String(password), u.password_hash) : false;
    if (!u || !okHash) return res.status(401).json({ error: 'Incorrect email or password' });
    if (!u.active) return res.status(403).json({ error: 'This account has been disabled' });
    await query(`UPDATE app_users SET last_login_at = NOW() WHERE id = $1`, [u.id]);
    res.json({ token: signToken(u), user: publicUser(u) });
  } catch (err) { next(err); }
});

// ─── Authenticated: current user + user management ───────────────────────────
router.get('/me', requireAuth, (req, res) => res.json(req.user || null));

router.get('/users', requireAuth, async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, email, full_name, is_admin, active, last_login_at, created_at
       FROM app_users ORDER BY created_at ASC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/users', requireAuth, async (req, res, next) => {
  try {
    const { full_name, email, password } = req.body || {};
    if (!validEmail(email)) return res.status(400).json({ error: 'A valid email is required' });
    if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const exists = await query(`SELECT 1 FROM app_users WHERE LOWER(email) = LOWER($1)`, [String(email).trim()]);
    if (exists.rows.length) return res.status(409).json({ error: 'A user with that email already exists' });
    const hash = await bcrypt.hash(String(password), 10);
    const { rows } = await query(
      `INSERT INTO app_users (email, full_name, password_hash) VALUES ($1,$2,$3)
       RETURNING id, email, full_name, is_admin, active, created_at`,
      [String(email).trim(), full_name || null, hash]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.patch('/users/:id', requireAuth, async (req, res, next) => {
  try {
    const { full_name, active, password } = req.body || {};
    const sets = [], vals = [];
    if (full_name !== undefined) { vals.push(full_name); sets.push(`full_name = $${vals.length}`); }
    if (active !== undefined)    { vals.push(!!active);  sets.push(`active = $${vals.length}`); }
    if (password) {
      if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      vals.push(await bcrypt.hash(String(password), 10)); sets.push(`password_hash = $${vals.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    const { rows } = await query(
      `UPDATE app_users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}
       RETURNING id, email, full_name, is_admin, active`, vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/users/:id', requireAuth, async (req, res, next) => {
  try {
    // Don't allow removing the last active admin (avoid lock-out).
    if (req.user && String(req.user.id) === String(req.params.id)) {
      const others = await query(`SELECT COUNT(*)::int AS n FROM app_users WHERE id <> $1 AND active = true`, [req.params.id]);
      if (others.rows[0].n === 0) return res.status(400).json({ error: "You can't remove the only active account" });
    }
    const { rows } = await query(`UPDATE app_users SET active = false, updated_at = NOW() WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, deactivated: rows[0].id });
  } catch (err) { next(err); }
});

export default router;
