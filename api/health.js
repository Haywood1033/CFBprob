// GET /api/health — checks each data source the model uses and reports what came back, so a
// changed feed shows up here first. ?probe=1 adds the raw shape of one ESPN game.
const { fetchJson, fetchText } = require('../lib/http');
const { SB } = require('../lib/espn');
const { BASE } = require('../lib/history');
const { etDate, seasonOf } = require('../lib/slate');
const db = require('../lib/db');
const { param, send } = require('./_util');

async function check(name, fn) { const t = Date.now(); try { const r = await fn(); return { name, ok: true, ms: Date.now() - t, ...r }; } catch (err) { return { name, ok: false, ms: Date.now() - t, error: err.message }; } }

module.exports = async (req, res) => {
  const date = param(req, 'date') || etDate(), season = seasonOf(date), probe = !!param(req, 'probe');
  const checks = await Promise.all([
    check('ESPN scoreboard (today)', async () => { const r = await fetchJson(`${SB}?groups=80&limit=400&dates=${date.replace(/-/g, '')}`, { ttlMs: 0 }); const e = r.events?.[0]; return { games: r.events?.length || 0, ...(probe && e ? { sample: { keys: Object.keys(e), competition: Object.keys(e.competitions?.[0] || {}), competitor: e.competitions?.[0]?.competitors?.[0], venue: e.competitions?.[0]?.venue, status: e.competitions?.[0]?.status } } : {}) }; }),
    check('ESPN week 1 results', async () => { const r = await fetchJson(`${SB}?groups=80&limit=400&seasontype=2&week=1&dates=${season}`, { ttlMs: 0 }); return { games: r.events?.length || 0 }; }),
    check(`cfbfastR-data ${season - 1} results`, async () => { const t = await fetchText(`${BASE}/schedules/csv/cfb_schedules_${season - 1}.csv`, { cache: false }); return { rows: t.split('\n').length - 1 }; }),
    check(`cfbfastR-data ${season} results`, async () => { const t = await fetchText(`${BASE}/schedules/csv/cfb_schedules_${season}.csv`, { cache: false }); return { rows: t.split('\n').length - 1 }; }),
    check('Geocoder', async () => { const r = await fetchJson('https://geocoding-api.open-meteo.com/v1/search?name=Tuscaloosa&count=1', { ttlMs: 0 }); return { found: r.results?.[0]?.name || null }; }),
    check('Weather', async () => { const r = await fetchJson('https://api.open-meteo.com/v1/forecast?latitude=33.21&longitude=-87.57&hourly=temperature_2m&forecast_days=1', { ttlMs: 0 }); return { hours: r.hourly?.time?.length || 0 }; }),
  ]);
  send(res, 200, { date, season, database: db.hasDb ? `connected (${db.dbVar})` : 'not connected: picks are not locked', checks });
};
