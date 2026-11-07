const test = require('node:test');
const assert = require('node:assert/strict');
const { installMockFetch } = require('./fixtures');
let world;
test.before(() => { world = installMockFetch(); });
test.after(() => world.restore());

// A finished day's picks as they'd have been saved before kickoff.
async function savedDay(date) {
  const s = await require('../lib/slate').buildSlate({ date });
  const games = s.games.map(g => ({ id: g.id, home: g.home.id, away: g.away.id, homeName: g.home.name, awayName: g.away.name, fbs: g.home.div === 'fbs' && g.away.div === 'fbs', pick: g.pick.team.id, pickName: g.pick.team.name, prob: g.pick.prob, tier: g.pick.tier, sharp: g.pick.sharp, risk: g.pick.risk, count: g.pick.count, start: g.date, state: 'pre' }));
  return { s, saved: { best: s.best, parlays: s.parlays, sharp: s.sharp, board: s.board, risks: s.risks, games } };
}

test('grading: a saved day against the finals', async () => {
  const { gradeDay, summarize } = require('../lib/grading');
  const date = '2026-10-24'; // week 9: final in the synthetic world
  const { s, saved } = await savedDay(date);
  const g = await gradeDay(date, saved);
  assert.equal(g.complete, true);
  assert.equal(g.games.length, s.games.length);
  for (const x of g.games) {
    const real = world.world.games.find(w => w.id === x.id);
    assert.equal(x.won, (real.home.id === x.pick ? real.hp > real.ap : real.ap > real.hp) ? 1 : 0, 'graded against the real final');
  }
  assert.ok(g.best && (g.best.won === 0 || g.best.won === 1));
  assert.deepEqual(g.parlays.map(p => p.legs), [3, 4, 5]);
  for (const p of g.parlays) assert.ok(p.hit === 0 || p.hit === 1);
  const sum = summarize([g]);
  assert.equal(sum.all.n, g.games.filter(x => x.fbs).length);
  assert.equal(sum.parlays[0].n, 1);
});

test('grading: a late lock only counts games that hadn’t started', async () => {
  const { gradeDay } = require('../lib/grading');
  const { saved } = await savedDay('2026-10-24');
  const keep = saved.games.slice(1); // the first game had started when it locked
  const g = await gradeDay('2026-10-24', { ...saved, games: keep, lockedLate: '2026-10-24T20:00:00Z' });
  const started = saved.games[0].id;
  assert.ok(!g.games.some(x => x.id === started));
  const kept = saved.parlays.filter(p => !p.picks.some(x => x.gameId === started)).map(p => p.legs);
  assert.deepEqual(g.parlays.map(p => p.legs), kept, 'a parlay with a started game is left out');
});

test('replay test: past weeks re-predicted and graded, end to end', async () => {
  let code = 200, body;
  const res = { setHeader() {}, status(c) { code = c; return this; }, json(b) { body = b; } };
  await require('../api/accuracy.js')({ method: 'GET', query: { replay: '1', seasons: 'current' }, url: '/' }, res);
  assert.equal(code, 200);
  assert.ok(body.days >= 9 && body.all.n > 50, `days ${body.days}, picks ${body.all.n}`);
  assert.ok(body.all.won / body.all.n > 0.55, 'the model beats a coin flip on its own world');
  assert.ok(body.parlays.every(p => p.n === body.fullDays));
});

test('accuracy without a database: says so', async () => {
  let body; const res = { setHeader() {}, status() { return this; }, json(b) { body = b; } };
  await require('../api/accuracy.js')({ method: 'GET', query: {}, url: '/' }, res);
  assert.equal(body.connected, false);
});
