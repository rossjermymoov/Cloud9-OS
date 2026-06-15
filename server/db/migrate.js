/**
 * Moov OS — Auto migration runner
 * Runs on server startup. Executes any pending .sql files in /db/migrations/
 * in alphabetical order and tracks them in a _migrations table.
 */

import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Split a SQL file into individual statements, respecting dollar-quoted blocks.
 *
 * A naive split on ";" breaks DO $$ … $$; blocks because every internal
 * semicolon (variable declarations, IF … END IF; etc.) becomes a separate
 * fragment that PostgreSQL rejects.
 *
 * Strategy: walk line by line, toggling `inDollarQuote` each time we see an
 * odd number of `$$` tokens on a line.  Only treat a trailing `;` as a
 * statement boundary when we are NOT inside a dollar-quoted block.
 */
function splitSqlStatements(sql) {
  const statements = [];
  let buffer       = '';
  let inDollar     = false;

  for (const line of sql.split('\n')) {
    buffer += line + '\n';

    // Count bare $$ occurrences on this line (ignores $tag$ variants for now,
    // which none of our migrations use).
    const dollarCount = (line.match(/\$\$/g) || []).length;
    if (dollarCount % 2 !== 0) inDollar = !inDollar;

    // A trailing semicolon outside a dollar-quoted block ends a statement.
    if (!inDollar && /;\s*$/.test(line)) {
      const stmt = buffer.trim().replace(/;\s*$/, '');
      // Push if ANY line in the buffer contains real SQL (not just comments/blanks).
      // The old check `!stmt.startsWith('--')` silently dropped every statement
      // whose buffer started with a section-header comment block.
      const hasSQL = stmt.split('\n').some(l => {
        const t = l.trim();
        return t && !t.startsWith('--');
      });
      if (hasSQL) statements.push(stmt);
      buffer = '';
    }
  }

  // Any remaining content (statement without trailing newline)
  const tail = buffer.trim();
  const tailHasSQL = tail.split('\n').some(l => { const t = l.trim(); return t && !t.startsWith('--'); });
  if (tailHasSQL) statements.push(tail);

  return statements;
}

export async function runMigrations() {
  console.log('🔄 Checking database migrations…');

  // Ensure tracking table exists
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename  VARCHAR(255) PRIMARY KEY,
      run_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Read migration files in alphabetical order
  const migrationsDir = join(__dirname, 'migrations');
  const files = (await readdir(migrationsDir))
    .filter(f => f.endsWith('.sql'))
    .sort();

  // Find which have already been run
  const { rows } = await query('SELECT filename FROM _migrations');
  const completed = new Set(rows.map(r => r.filename));

  let ran = 0;
  for (const file of files) {
    if (completed.has(file)) continue;

    console.log(`  ↳ Running migration: ${file}`);
    const sql = await readFile(join(migrationsDir, file), 'utf8');

    try {
      // Split on statement boundaries and run each statement individually.
      // This is required for migrations that contain ALTER TYPE ADD VALUE —
      // PostgreSQL does not allow a newly-added enum value to be used in the
      // same transaction in which it was created, so each statement must be
      // committed separately.
      //
      // We must NOT split inside dollar-quoted blocks (DO $$ … $$; or
      // CREATE FUNCTION … $$; etc.) — splitting there would send fragments
      // like "qid UUID" to the server, causing confusing parse errors.
      const statements = splitSqlStatements(sql);

      for (const stmt of statements) {
        await query(stmt);
      }

      await query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      console.log(`  ✓ ${file}`);
      ran++;
    } catch (err) {
      console.error(`  ✖ Migration failed: ${file}`, err.message);
      throw err; // halt startup — do not run a broken database
    }
  }

  if (ran === 0) {
    console.log('  ✓ All migrations already applied');
  } else {
    console.log(`  ✓ Applied ${ran} migration(s)`);
  }
}
