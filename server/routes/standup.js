/**
 * Cloud9 OS — Morning Standup API Routes
 */

import express from 'express';
import { getStandupSummary, runMorningPrecompute } from '../services/standupService.js';

const router = express.Router();

// GET /api/standup/summary
router.get('/summary', async (_req, res) => {
  try {
    const summary = await getStandupSummary();
    res.json(summary);
  } catch (err) {
    console.error('[standup-api] summary error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/standup/refresh - Trigger on-demand recalculation
router.post('/refresh', async (_req, res) => {
  try {
    const result = await runMorningPrecompute();
    const summary = await getStandupSummary();
    res.json({ ...result, summary });
  } catch (err) {
    console.error('[standup-api] refresh error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
