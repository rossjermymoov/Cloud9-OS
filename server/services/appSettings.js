/**
 * Cloud9 OS — global key/value settings (app_settings table).
 * Small typed helpers so routes don't re-implement the same upsert each time.
 */
import { query } from '../db/index.js';

export async function getSetting(key, fallback = null) {
  try {
    const { rows } = await query(`SELECT value FROM app_settings WHERE key = $1`, [key]);
    return rows.length ? rows[0].value : fallback;
  } catch { return fallback; }
}

export async function setSetting(key, value) {
  await query(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ($1, $2::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `, [key, JSON.stringify(value)]);
  return value;
}
