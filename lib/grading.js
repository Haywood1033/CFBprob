// lib/grading.js — the tracked record: each day's locked picks (saved before kickoff by lib/slate),
// checked against the final scores. A day's grade is saved once every game on it is final, so a
// finished day is never fetched again. Nothing is changed after the fact: the picks graded are the
// ones saved before the games started.

const { fetchDay } = require('./espn');
const { mapLimit } = require('./http');
const db = require('./db');

// One saved day against ESPN's finals.
async function gradeDay(date, saved) {
  const finals = new Map((await fetchDay(date)).map(g => [g.id, g]));
  const snap = saved.games || [];
  const tracked = new Set(snap.map(g => g.id)); // a late lock tracks only the games not yet started
  const res = id => { const f = finals.get(id); if (!f || f.state !== 'post' || f.hp === null) return null; return f; };
  const won = (gameId, teamId) => { const f = res(gameId); if (!f) return null; const home = f.home.id === teamId; return (home ? f.hp > f.ap : f.ap > f.hp) ? 1 : 0; };
  const games = snap.map(g => { const f = res(g.id); return { ...g, final: f ? `${g.awayName} ${f.ap}, ${g.homeName} ${f.hp}` : null, won: f ? won(g.id, g.pick) : null }; });
  const ok = id => !saved.lockedLate || tracked.has(id);
  const list = xs => (xs || []).filter(x => ok(x.gameId)).map(x => ({ gameId: x.gameId, team: x.team?.name, teamId: x.team?.id, prob: x.prob, tier: x.tier, sharp: x.sharp, won: won(x.gameId, x.team?.id) }));
  const best = saved.best && ok(saved.best.gameId) ? { team: saved.best.team?.name, opp: saved.best.opp?.name, prob: saved.best.prob, sharp: saved.best.sharp, tier: saved.best.tier, won: won(saved.best.gameId, saved.best.team?.id) } : null;
  const parlays = (saved.parlays || []).filter(p => p.available && p.picks.every(x => ok(x.gameId))).map(p => {
    const legs = p.picks.map(x => won(x.gameId, x.team?.id));
    return { legs: p.legs, joint: p.joint, teams: p.picks.map(x => x.team?.name), hit: legs.some(x => x === 0) ? 0 : legs.every(x => x === 1) ? 1 : null, legsWon: legs.filter(x => x === 1).length };
  });
  const complete = games.every(g => g.won !== null);
  return { date, complete, games, best, parlays, sharp: list(saved.sharp), board: list(saved.board), risks: list(saved.risks) };
}

// Grades every saved day (finished days from their saved grade), newest first.
async function gradeAll({ limit = 120 } = {}) {
  const rows = await db.loadAllPicks(limit);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const days = await mapLimit(rows, 4, async r => {
    if (r.graded?.complete) return r.graded;
    if (r.date > today) return null;
    const g = await gradeDay(r.date, r.payload).catch(() => null);
    if (g?.complete) await db.saveGraded(r.date, g);
    return g;
  });
  return days.filter(Boolean);
}

// Totals across days: only decided games count.
function summarize(days) {
  const rec = xs => { const d = xs.filter(x => x.won !== null && x.won !== undefined); return { n: d.length, won: d.filter(x => x.won === 1).length, predicted: d.length ? d.reduce((s, x) => s + x.prob, 0) / d.length : null }; };
  const games = days.flatMap(d => d.games.filter(g => g.fbs));
  const tiers = ['Elite', 'All-Star', 'Value', null].map(t => ({ tier: t || 'No tag', ...rec(games.filter(g => (g.tier || null) === t)) }));
  const bins = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]].map(([lo, hi]) => ({ lo, hi: Math.min(1, hi), ...rec(games.filter(g => g.prob >= lo && g.prob < hi)) }));
  const parlays = [3, 4, 5].map(n => { const ps = days.flatMap(d => d.parlays.filter(p => p.legs === n && p.hit !== null)); return { legs: n, n: ps.length, hit: ps.filter(p => p.hit === 1).length, predicted: ps.length ? ps.reduce((s, p) => s + p.joint, 0) / ps.length : null }; });
  return {
    days: days.length, gradedDays: days.filter(d => d.complete).length,
    all: rec(games), allGames: rec(days.flatMap(d => d.games)),
    best: rec(days.map(d => d.best).filter(Boolean)), sharp: rec(days.flatMap(d => d.sharp)), board: rec(days.flatMap(d => d.board)), risks: rec(days.flatMap(d => d.risks)),
    tiers, bins, parlays,
  };
}

module.exports = { gradeDay, gradeAll, summarize };
