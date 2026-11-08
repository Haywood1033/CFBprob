// lib/slate.js — one day's games with the model's projection, pick, signals and conditions, plus the
// best play and the 3-, 4- and 5-leg parlays (locked at the first kickoff with a database).
//
// Steps: last season's results → a prior; this season's results (cfbfastR-data, topped up live from
// ESPN) → ratings as of this morning; the day's games from ESPN; rest, travel and weather per game;
// a projection and a pick per game; then the best play and parlays.

const { loadSeason } = require('./history');
const { fetchDay, fetchSeasonResults } = require('./espn');
const { fitRatings, carryPrior, predict } = require('./ratings');
const { conditionsFor } = require('./conditions');
const { pickFor, bestAndParlays, SIGNALS, TIERS } = require('./picks');
const lock = require('./lock');
const { hasStarted } = lock;

const CACHE_MS = 5 * 60 * 1000, LIVE_CACHE_MS = 45 * 1000;
const cache = new Map();

// Today in US Eastern time (YYYY-MM-DD).
function etDate(d = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
// The season a date belongs to: August through January bowls count toward the fall's year.
const seasonOf = date => { const [y, m] = date.split('-').map(Number); return m >= 7 ? y : y - 1; };

async function buildSlate({ date = etDate() } = {}) {
  const season = seasonOf(date);
  const [prevRaw, curRaw] = await Promise.all([loadSeason(season - 1).catch(() => []), loadSeason(season).catch(() => [])]);
  const fbs = new Set([...prevRaw, ...curRaw].flatMap(g => [g.home, g.away]).filter(s => s.div === 'fbs').map(s => s.id));
  const [live, day] = await Promise.all([fetchSeasonResults(season, { fbs }).catch(() => []), fetchDay(date, { fbs })]);
  // This season's results: cfbfastR-data, with ESPN's (which carry venue cities) taking over by id.
  const byId = new Map(curRaw.filter(g => g.completed && g.hp !== null).map(g => [g.id, g]));
  for (const g of live) { const old = byId.get(g.id); byId.set(g.id, { ...g, home: { ...g.home, conf: old?.home.conf ?? g.home.conf, div: old?.home.div || g.home.div }, away: { ...g.away, conf: old?.away.conf ?? g.away.conf, div: old?.away.div || g.away.div } }); }
  const results = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
  // Ratings: last season (all of it) → prior; this season up to this morning.
  const prev = fitRatings(prevRaw.filter(g => g.completed && g.hp !== null), '9999-12-31');
  const asOf = `${date}T08:00:00Z`;
  const R = fitRatings(results, asOf, { prior: carryPrior(prev) });
  for (const g of day) for (const s of ['home', 'away']) { const t = R.teams.get(g[s].id); if (t?.conf && !g[s].conf) g[s].conf = t.conf; if (!g[s].div) g[s].div = fbs.has(g[s].id) ? 'fbs' : 'fcs'; }

  const conds = await conditionsFor(day, results).catch(() => day.map(() => null));
  const games = day.map((g, i) => {
    const cond = conds[i];
    const pred = predict(R, g.home, g.away, { neutral: g.neutral, adj: cond?.adj });
    const pick = pickFor(g, pred, cond, results);
    const team = (s, t) => ({ ...g[s], rating: +t.rating.toFixed(1), off: +(R.mu + t.off).toFixed(1), def: +(R.mu - t.def).toFixed(1), rank: g[s].rank, rated: !t.unrated });
    return {
      ...g, home: team('home', pred.home), away: team('away', pred.away),
      model: { pHome: pred.pHome, margin: +pred.margin.toFixed(1), total: +pred.total.toFixed(1), ph: +pred.ph.toFixed(1), pa: +pred.pa.toFixed(1), homeField: +pred.homeField.toFixed(1) },
      conditions: cond, pick,
    };
  }).sort((a, b) => a.date.localeCompare(b.date) || (b.pick.prob - a.pick.prob));

  const fresh = bestAndParlays(games);
  const plays = await lockPlays(date, games, fresh);
  return {
    date, season, generatedAt: new Date().toISOString(),
    games, best: plays.best, parlays: plays.parlays, sharp: plays.sharp, board: plays.board, risks: plays.risks, lock: plays.lock,
    signals: SIGNALS, tiers: TIERS,
    league: { pointsPerTeam: +R.mu.toFixed(1), homeField: +R.H.toFixed(1), gamesRated: R.games },
  };
}

// The day's picks, locked write-once at the first kickoff (lib/lock): saved as a draft on every build
// before then (and by the 11:30 ET daily run), sealed by the database at the first kickoff and never
// changed after. The picks are built from ratings as of this morning, so a late lock (nothing saved in
// time) lands on the same picks; a database that doesn't answer writes nothing and the morning picks
// show as "unconfirmed". Every game's pick is saved too, for the Accuracy tab.
async function lockPlays(date, games, fresh) {
  const snap = games.map(g => ({ id: g.id, home: g.home.id, away: g.away.id, homeName: g.home.name, awayName: g.away.name, fbs: g.home.div === 'fbs' && g.away.div === 'fbs', pick: g.pick.team.id, pickName: g.pick.team.name, prob: +g.pick.prob.toFixed(4), tier: g.pick.tier, sharp: g.pick.sharp, risk: g.pick.risk, count: g.pick.count, margin: g.model.margin, total: g.model.total, line: g.line || null, marketGap: g.pick.marketGap, flags: g.pick.flags.map(f => f.key), start: g.date, state: g.state }));
  const keep = { best: fresh.best, parlays: fresh.parlays, sharp: fresh.sharp, board: fresh.board, risks: fresh.risks, games: snap };
  const view = (p, lock) => ({ best: p.best, parlays: p.parlays, sharp: p.sharp || [], board: p.board || [], risks: p.risks || [], lock });
  if (!hasStarted(games)) {
    const r = await lock.draft('cfb_daily_picks', date, keep);
    return r.payload ? view(r.payload, { state: 'locked', savedAt: r.savedAt }) : view(keep, { state: r.state });
  }
  // A late lock tracks only the games that hadn't kicked off (the Accuracy tab grades nothing in hindsight).
  const late = { ...keep, games: snap.filter(g => g.state === 'pre' && Date.parse(g.start) > Date.now()), lockedLate: new Date().toISOString() };
  const r = await lock.seal('cfb_daily_picks', date, late);
  return r.payload ? view(r.payload, { state: r.state, savedAt: r.savedAt, lockedAt: r.lockedAt }) : view(keep, { state: r.state });
}

async function getSlate({ date = etDate() } = {}) {
  const hit = cache.get(date);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const p = buildSlate({ date });
  cache.set(date, { at: Date.now(), ttl: CACHE_MS, value: p });
  try {
    const v = await p;
    if (v.games.some(g => g.state === 'in')) cache.set(date, { at: Date.now(), ttl: LIVE_CACHE_MS, value: p });
    if (cache.size > 8) cache.delete(cache.keys().next().value);
    return v;
  } catch (err) { cache.delete(date); throw err; }
}

module.exports = { buildSlate, getSlate, etDate, seasonOf, lockPlays };
