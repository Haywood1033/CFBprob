// lib/db.js — optional Postgres: locks the day's picks at the first kickoff (so they don't change as
// games start) and keeps them, graded after the games, for the Accuracy tab's tracked record.
// Without a database everything else works; the picks just aren't locked or tracked. Any of these variables works (Vercel's Postgres, Neon, Supabase and
// Prisma integrations each set one); sslmode in the URL is stripped and TLS stays on.
const DB_VARS = ['DATABASE_URL', 'DATABASE_URL_POOLED', 'POSTGRES_URL', 'PRISMA_DATABASE_URL', 'POSTGRES_URL_NON_POOLING', 'SUPABASE_DB_URL'];
const dbVar = DB_VARS.find(k => process.env[k]) || null;
const hasDb = !!dbVar;
const sslOff = () => { try { return new URL(process.env[dbVar]).searchParams.get('sslmode') === 'disable'; } catch { return false; } };
function connectionString() {
  try { const u = new URL(process.env[dbVar]); ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'supa'].forEach(k => u.searchParams.delete(k)); return u.toString(); } catch { return process.env[dbVar]; }
}
let pool = null, ensured = null;
function getPool() {
  if (!pool) { const { Pool } = require('pg'); pool = new Pool({ connectionString: connectionString(), ssl: sslOff() ? false : { rejectUnauthorized: false }, max: 3, connectionTimeoutMillis: 8000 }); }
  return pool;
}
async function query(text, params) { const c = await getPool().connect(); try { return await c.query(text, params); } finally { c.release(); } }
function ensureTables() {
  if (!ensured) ensured = query(`CREATE TABLE IF NOT EXISTS cfb_daily_picks (game_date DATE PRIMARY KEY, payload JSONB, saved_at TIMESTAMP DEFAULT NOW());
    ALTER TABLE cfb_daily_picks ADD COLUMN IF NOT EXISTS graded JSONB;
    ALTER TABLE cfb_daily_picks ADD COLUMN IF NOT EXISTS graded_at TIMESTAMP;
    ALTER TABLE cfb_daily_picks ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP`).catch(e => { ensured = null; throw e; });
  return ensured;
}
// Resolves with the promise's result, or rejects after ms, so a slow database can't hang a request.
function withTimeout(promise, ms, what = 'database') {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms); })]).finally(() => clearTimeout(t));
}

// Every saved day, newest first, with its grades (Accuracy tab).
async function loadAllPicks(limit = 120) {
  if (!hasDb) return [];
  await ensureTables();
  const r = await query(`SELECT to_char(game_date, 'YYYY-MM-DD') AS date, payload, saved_at, graded, graded_at FROM cfb_daily_picks ORDER BY game_date DESC LIMIT $1`, [limit]);
  return r.rows;
}
async function saveGraded(date, graded) {
  if (!hasDb) return false;
  try { await ensureTables(); await query(`UPDATE cfb_daily_picks SET graded = $2, graded_at = NOW() WHERE game_date = $1`, [date, JSON.stringify(graded)]); return true; } catch { return false; }
}

module.exports = { hasDb, dbVar, query, loadAllPicks, saveGraded, ensureTables, withTimeout };
