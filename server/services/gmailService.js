/**
 * gmailService.js — Read-only Gmail OAuth2 wrapper
 * Scopes: gmail.readonly only. Never requests send permission.
 */

import { google } from 'googleapis';
import { query } from '../db/index.js';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

// Read an OAuth env var, trimmed — a stray space/newline in a hosting dashboard
// is a classic cause of redirect_uri / client mismatches.
function oauthEnv(name) {
  const v = (process.env[name] || '').trim();
  if (!v) throw new Error(`Gmail OAuth misconfigured: missing env var ${name}`);
  return v;
}

export function createOAuthClient() {
  return new google.auth.OAuth2(
    oauthEnv('GMAIL_CLIENT_ID'),
    oauthEnv('GMAIL_CLIENT_SECRET'),
    // Must match an "Authorized redirect URI" on the OAuth client EXACTLY —
    // same scheme (https), same path, and no extra/missing trailing slash.
    oauthEnv('GMAIL_REDIRECT_URI'),
  );
}

export function getAuthUrl() {
  const redirectUri = oauthEnv('GMAIL_REDIRECT_URI');
  const oauth2Client = createOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    include_granted_scopes: true,
  });
  // Surface exactly what we send Google so a 400 (redirect_uri/scope mismatch)
  // is obvious from the logs — compare these to the Google console line-for-line.
  console.log('[Gmail OAuth] redirect_uri =', JSON.stringify(redirectUri));
  console.log('[Gmail OAuth] scopes       =', SCOPES.join(' '));
  return url;
}

export async function exchangeCodeForTokens(code) {
  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export async function getAuthedClient() {
  const row = await getConfig();
  if (!row?.refresh_token) throw new Error('Gmail not connected');

  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    access_token:  row.access_token,
    refresh_token: row.refresh_token,
    expiry_date:   row.token_expiry ? new Date(row.token_expiry).getTime() : undefined,
  });

  // Auto-refresh and persist new tokens
  oauth2Client.on('tokens', async (tokens) => {
    const updates = [];
    const vals = [];
    let idx = 1;
    if (tokens.access_token)  { updates.push(`access_token = $${idx++}`);  vals.push(tokens.access_token); }
    if (tokens.expiry_date)   { updates.push(`token_expiry = $${idx++}`);  vals.push(new Date(tokens.expiry_date)); }
    if (updates.length) {
      vals.push(1);
      await query(`UPDATE gmail_oauth_config SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, vals);
    }
  });

  return oauth2Client;
}

export async function getConfig() {
  const res = await query('SELECT * FROM gmail_oauth_config WHERE id = 1');
  return res.rows[0] || null;
}

export async function saveTokens(tokens, emailAddress) {
  await query(`
    UPDATE gmail_oauth_config SET
      access_token   = $1,
      refresh_token  = $2,
      token_expiry   = $3,
      email_address  = $4,
      connected_at   = NOW(),
      updated_at     = NOW()
    WHERE id = 1
  `, [
    tokens.access_token,
    tokens.refresh_token,
    tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    emailAddress,
  ]);
}

export async function disconnect() {
  await query(`
    UPDATE gmail_oauth_config SET
      access_token = NULL, refresh_token = NULL, token_expiry = NULL,
      email_address = NULL, connected_at = NULL, last_history_id = NULL,
      updated_at = NOW()
    WHERE id = 1
  `);
}

export async function updateLastSync(historyId) {
  await query(`
    UPDATE gmail_oauth_config SET last_sync_at = NOW(), last_history_id = $1, updated_at = NOW() WHERE id = 1
  `, [historyId ? String(historyId) : null]);
}
