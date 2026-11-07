// lib/history.js — past results for the ratings: each season's schedule with final scores from
// cfbfastR-data (CFBD-derived, served from raw GitHub), normalized to one game shape. The
// current season's latest weeks lag there by a few days, so lib/espn.js fills them in live.
//
// Game: { id, season, week, date (ISO), neutral, completed, home: { id, name, conf, div },
//         away: { … }, hp, ap (final points, null until played), venue }

const { fetchText, TTL } = require('./http');
const { parseCsv } = require('./csv');

const BASE = 'https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main';
const memo = new Map(); // season -> { at, games }

const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
const bool = v => v === true || v === 'TRUE' || v === 'true';

function normalize(r) {
  return {
    id: String(r.game_id), season: num(r.season), week: num(r.week), seasonType: r.season_type || 'regular',
    date: r.start_date, neutral: bool(r.neutral_site), completed: bool(r.completed), venue: r.venue || null,
    home: { id: String(r.home_id), name: r.home_team, conf: r.home_conference || null, div: (r.home_division || '').toLowerCase() || null },
    away: { id: String(r.away_id), name: r.away_team, conf: r.away_conference || null, div: (r.away_division || '').toLowerCase() || null },
    hp: num(r.home_points), ap: num(r.away_points),
  };
}

async function loadSeason(season, { text = null } = {}) {
  const hit = memo.get(season);
  if (hit && Date.now() - hit.at < TTL.long) return hit.games;
  const csv = text ?? await fetchText(`${BASE}/schedules/csv/cfb_schedules_${season}.csv`, { timeoutMs: 20000, cache: false });
  const games = parseCsv(csv).map(normalize).filter(g => g.home.id && g.away.id);
  memo.set(season, { at: Date.now(), games });
  return games;
}

// Completed games of these seasons, oldest first.
async function loadResults(seasons) {
  const all = (await Promise.all(seasons.map(s => loadSeason(s).catch(() => [])))).flat();
  return all.filter(g => g.completed && g.hp !== null && g.ap !== null).sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { loadSeason, loadResults, normalize, BASE };
