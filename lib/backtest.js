// lib/backtest.js — the Replay test: past weeks re-predicted with ratings built only from games
// before each week (last season carried in, exactly as the live app does), then the day's picks,
// best play, parlays and risks are built with the live app's own code and graded.
//
// Travel and weather aren't in the historical results, so those two signals never fire here; rest
// and form come from the schedule. Results come from cfbfastR-data, with ESPN filling this
// season's latest weeks.

const { loadSeason } = require('./history');
const { fetchSeasonResults } = require('./espn');
const { fitRatings, carryPrior, predict } = require('./ratings');
const { restDays } = require('./conditions');
const { pickFor, bestAndParlays } = require('./picks');
const { summarize } = require('./grading');

const etDay = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));

async function seasonResults(season, current) {
  const csv = (await loadSeason(season).catch(() => [])).filter(g => g.completed && g.hp !== null);
  if (!current) return csv;
  const fbs = new Set(csv.flatMap(g => [g.home, g.away]).filter(s => s.div === 'fbs').map(s => s.id));
  const live = await fetchSeasonResults(season, { fbs }).catch(() => []);
  const byId = new Map(csv.map(g => [g.id, g]));
  for (const g of live) if (!byId.has(g.id)) byId.set(g.id, { ...g, home: { ...g.home, div: g.home.div || (fbs.has(g.home.id) ? 'fbs' : 'fcs') }, away: { ...g.away, div: g.away.div || (fbs.has(g.away.id) ? 'fbs' : 'fcs') } });
  return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function runBacktest({ seasons, currentSeason }) {
  const days = [];
  for (const season of seasons) {
    const [prev, cur] = await Promise.all([seasonResults(season - 1, false), seasonResults(season, season === currentSeason)]);
    const prior = carryPrior(fitRatings(prev, '9999-12-31'));
    const byDay = new Map();
    for (const g of cur) { const d = etDay(g.date); (byDay.get(d) || byDay.set(d, []).get(d)).push(g); }
    for (const [date, gs] of [...byDay].sort()) {
      const R = fitRatings(cur, `${date}T08:00:00Z`, { prior });
      const games = gs.map(g => {
        const pred = predict(R, g.home, g.away, { neutral: g.neutral });
        const cond = { rest: { home: restDays(cur, g.home.id, g.date), away: restDays(cur, g.away.id, g.date) }, travel: null, weather: null };
        const pick = pickFor(g, pred, cond, cur);
        return { ...g, state: 'post', pick };
      });
      const lists = bestAndParlays(games);
      const won = (gameId, teamId) => { const g = games.find(x => x.id === gameId); return (g.home.id === teamId ? g.hp > g.ap : g.ap > g.hp) ? 1 : 0; };
      const L = xs => (xs || []).map(x => ({ gameId: x.gameId, prob: x.prob, tier: x.tier, sharp: x.sharp, won: won(x.gameId, x.team.id) }));
      days.push({
        date, season, complete: true,
        games: games.map(g => ({ id: g.id, fbs: g.home.div === 'fbs' && g.away.div === 'fbs', prob: g.pick.prob, tier: g.pick.tier, sharp: g.pick.sharp, risk: g.pick.risk, won: won(g.id, g.pick.team.id) })),
        best: lists.best ? { prob: lists.best.prob, sharp: lists.best.sharp, tier: lists.best.tier, won: won(lists.best.gameId, lists.best.team.id) } : null,
        parlays: lists.parlays.filter(p => p.available).map(p => { const legs = p.picks.map(x => won(x.gameId, x.team.id)); return { legs: p.legs, joint: p.joint, hit: legs.every(x => x === 1) ? 1 : 0 }; }),
        sharp: L(lists.sharp), board: L(lists.board), risks: L(lists.risks),
      });
    }
  }
  // Parlays only mean something on full slates: count days with 8+ FBS-vs-FBS games (Saturdays).
  const full = days.filter(d => d.games.filter(g => g.fbs).length >= 8);
  const s = summarize(days), sf = summarize(full);
  return { generatedAt: new Date().toISOString(), seasons, days: days.length, fullDays: full.length, ...s, parlays: sf.parlays, best: sf.best, bestAllDays: s.best };
}

module.exports = { runBacktest };
