/**
 * Cloud9 OS — Settings API (authenticated).
 *
 * Global app settings that aren't tied to a single feature page. First use:
 * warehouse-board messages (a morning welcome slide + a timed urgent banner)
 * that surface on the public TV board.
 */
import express from 'express';
import { getSetting, setSetting } from '../services/appSettings.js';

const router = express.Router();

const WELCOME_KEY = 'board_welcome';
const URGENT_KEY  = 'board_urgent';

// Shape the stored settings into the live state the UI/board care about.
function activeUrgent(u) {
  if (!u || !u.message) return null;
  if (u.expires_at && new Date(u.expires_at).getTime() <= Date.now()) return null;  // timer elapsed
  return { message: u.message, expires_at: u.expires_at || null };
}
function activeWelcome(w) {
  if (!w || !w.enabled || !String(w.who || '').trim()) return null;
  return { who: String(w.who).trim() };
}

router.get('/board-messages', async (_req, res, next) => {
  try {
    const [w, u] = await Promise.all([getSetting(WELCOME_KEY), getSetting(URGENT_KEY)]);
    res.json({
      welcome: { enabled: !!w?.enabled, who: w?.who || '' },
      urgent:  { message: u?.message || '', expires_at: u?.expires_at || null, active: !!activeUrgent(u) },
    });
  } catch (err) { next(err); }
});

router.put('/board-welcome', async (req, res, next) => {
  try {
    const enabled = !!req.body?.enabled;
    const who = String(req.body?.who || '').slice(0, 200);
    const saved = await setSetting(WELCOME_KEY, { enabled, who });
    res.json(saved);
  } catch (err) { next(err); }
});

// Post / extend an urgent banner. Body: { message, minutes } to show, or { clear:true }.
router.put('/board-urgent', async (req, res, next) => {
  try {
    if (req.body?.clear) { const saved = await setSetting(URGENT_KEY, { message: '', expires_at: null }); return res.json(saved); }
    const message = String(req.body?.message || '').trim().slice(0, 280);
    const minutes = Math.min(720, Math.max(1, parseInt(req.body?.minutes) || 30));
    if (!message) return res.status(400).json({ error: 'message is required' });
    const expires_at = new Date(Date.now() + minutes * 60000).toISOString();
    const saved = await setSetting(URGENT_KEY, { message, expires_at });
    res.json(saved);
  } catch (err) { next(err); }
});

export default router;
