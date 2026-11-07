const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv } = require('../lib/csv');
const { makeWorld, scheduleCsv, installMockFetch } = require('./fixtures');
const { normalize } = require('../lib/history');
const RT = require('../lib/ratings');
const { weatherEffect, miles, restDays } = require('../lib/conditions');
const { bestAndParlays, pickFor, order } = require('../lib/picks');

test('csv: quoted commas and quotes, NA as null', () => {
  const rows = parseCsv('a,b,c\n1,"x, ""y""",NA\n2,,z\n');
  assert.deepEqual(rows, [{ a: '1', b: 'x, "y"', c: null }, { a: '2', b: null, c: 'z' }]);
});

test('ratings: recover the true team strengths from scores alone', () => {
  const w = makeWorld();
  const games = parseCsv(scheduleCsv(w, 2025)).map(normalize).filter(g => g.completed);
  const R = RT.fitRatings(games, '2026-01-31');
  const fbs = w.teams.filter(t => t.div === 'fbs');
  const corr = (a, b) => { const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length; const c = a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0); return c / Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0) * b.reduce((s, x) => s + (x - mb) ** 2, 0)); };
  const r = corr(fbs.map(t => t.off + t.def), fbs.map(t => R.teams.get(t.id).rating));
  assert.ok(r > 0.8, `ratings track true strength (r = ${r.toFixed(2)})`);
  assert.ok(R.H > 0 && R.H < 8, `home field ${R.H.toFixed(1)}`);
  assert.ok(R.lvl.fcs.o + R.lvl.fcs.d < -5, 'FCS teams rated well below FBS');
});

test('ratings: a team with no games yet starts from its prior; predictions are symmetric', () => {
  const prior = new Map([['A', { o: 7, d: 3, div: 'fbs' }], ['B', { o: -2, d: -2, div: 'fbs' }]]);
  const R = RT.fitRatings([], '2026-09-01', { prior });
  const p = RT.predict(R, { id: 'A' }, { id: 'B' }, { neutral: true });
  assert.ok(Math.abs(p.margin - 14) < 1e-9, 'margin = (7+3) − (−2−2)');
  const q = RT.predict(R, { id: 'B' }, { id: 'A' }, { neutral: true });
  assert.ok(Math.abs(p.pHome + q.pHome - 1) < 1e-9);
  const h = RT.predict(R, { id: 'A' }, { id: 'B' }, { neutral: false });
  assert.ok(h.margin > p.margin, 'home field adds to the home margin');
});

test('conditions: weather, distance, rest', () => {
  assert.equal(weatherEffect({ dome: true }).total, 0);
  assert.equal(weatherEffect({ temp: 60, wind: 6, precip: 0 }).adverse, false);
  const bad = weatherEffect({ temp: 20, wind: 22, precip: 0.2 });
  assert.ok(bad.adverse && bad.total <= -7 && bad.notes.length === 3);
  const d = miles({ lat: 33.21, lon: -87.57 }, { lat: 44.05, lon: -123.09 });
  assert.ok(d > 2000 && d < 2200, `Tuscaloosa → Eugene ${Math.round(d)} mi`);
  const res = [{ date: '2026-10-24T19:00:00Z', home: { id: 'A' }, away: { id: 'B' } }, { date: '2026-10-31T19:00:00Z', home: { id: 'C' }, away: { id: 'A' } }];
  assert.equal(restDays(res, 'A', '2026-11-07T19:00:00Z'), 7); assert.equal(restDays(res, 'B', '2026-11-07T19:00:00Z'), 14); assert.equal(restDays(res, 'Z', '2026-11-07T19:00:00Z'), null);
});

test('picks: sharp needs power + defense + (home, rest or travel); best play and parlays order', () => {
  const g = { id: 'g1', date: '2026-11-07T19:00:00Z', neutral: false, state: 'pre', home: { id: 'H', name: 'Home', div: 'fbs' }, away: { id: 'A', name: 'Away', div: 'fbs' } };
  const pred = { pHome: 0.85, ph: 35, pa: 14, margin: 21, homeField: 3 };
  const p = pickFor(g, pred, { rest: { home: 7, away: 7 }, travel: { away: { miles: 300, zones: 0 }, home: { miles: 0, zones: 0 } }, weather: { temp: 60, wind: 5, precip: 0, effect: { notes: [] } } }, []);
  assert.equal(p.side, 'home'); assert.equal(p.sharp, true);
  assert.deepEqual(p.signals.filter(s => s.on).map(s => s.key), ['power', 'home', 'offense', 'defense', 'clean']);
  assert.equal(p.tier, 'All-Star');
  const road = pickFor({ ...g, neutral: true }, pred, { rest: { home: 7, away: 7 }, travel: { away: { miles: 300 }, home: { miles: 300 } } }, []);
  assert.equal(road.sharp, false, 'no home, rest or travel edge');
  // Ordering and parlays: FCS games left out, one leg per game, nested legs.
  const mk = (id, prob, sharp, count, div = 'fbs') => ({ id, state: 'pre', date: '2026-11-07T19:00:00Z', home: { id: id + 'h', div }, away: { id: id + 'a', div: 'fbs' }, pick: { prob, sharp, count, team: { id: id + 'h' }, opp: { id: id + 'a' }, signals: [] } });
  const games = [mk('a', 0.95, false, 6), mk('b', 0.8, true, 5), mk('c', 0.7, false, 3), mk('d', 0.99, true, 7, 'fcs'), mk('e', 0.65, false, 3), mk('f', 0.6, false, 2)];
  const r = bestAndParlays(games);
  assert.equal(r.best.gameId, 'b', 'a sharp play beats a higher chance');
  assert.deepEqual(r.parlays.map(x => x.picks.map(y => y.gameId).join('')), ['bac', 'bace', 'bacef']);
  assert.ok(Math.abs(r.parlays[0].joint - 0.8 * 0.95 * 0.7) < 1e-12);
  assert.ok(order(games[1].pick, games[0].pick) < 0);
});
