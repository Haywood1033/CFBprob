const test = require('node:test');
const assert = require('node:assert/strict');
const { installMockFetch } = require('./fixtures');
let world;
test.before(() => { world = installMockFetch(); });
test.after(() => world.restore());
const call = (name, query = {}) => new Promise((resolve, reject) => { let code = 200; const res = { setHeader() {}, status(c) { code = c; return this; }, json(b) { resolve({ code, body: b }); } }; require(`../api/${name}.js`)({ method: 'GET', query, url: '/' }, res).catch(reject); });

test('slate: every game projected and picked, best play and parlays from FBS games', async () => {
  const { code, body } = await call('slate', { date: '2026-11-07' });
  assert.equal(code, 200);
  assert.equal(body.games.length, 12);
  for (const g of body.games) {
    assert.ok(g.model.pHome > 0 && g.model.pHome < 1 && g.pick.prob >= 0.5);
    assert.equal(g.pick.signals.length, 8);
    assert.ok(g.conditions.weather, 'every game has a forecast or a dome');
  }
  assert.ok(body.games.some(g => g.conditions.weather.dome), 'the dome game');
  assert.ok(body.games.some(g => g.conditions.weather.effect?.total < 0), 'the windy game lowers its total');
  assert.ok(body.games.some(g => g.conditions.travel.away.miles > 1000), 'travel distances');
  assert.ok(body.best && body.best.gameId);
  assert.deepEqual(body.parlays.map(p => p.picks.length), [3, 4, 5]);
  assert.equal(new Set(body.parlays[2].picks.map(p => p.gameId)).size, 5, 'one leg per game');
  assert.equal(body.parlays[0].picks[0].gameId, body.best.gameId, 'the best play leads the parlays');
  assert.equal(body.lock.state, 'off', 'no database, no lock');
  // the CSV lagged a week; ESPN filled it in
  assert.ok(body.league.gamesRated >= 9 * 12 - 4);
});

test('slate: bad date is a 400; a day with no games is empty, not an error', async () => {
  assert.equal((await call('slate', { date: 'nope' })).code, 400);
  const { code, body } = await call('slate', { date: '2026-11-03' });
  assert.equal(code, 200); assert.equal(body.games.length, 0); assert.equal(body.best, null);
});

test('health: every source answers', async () => {
  const { body } = await call('health', { date: '2026-11-07' });
  assert.ok(body.checks.every(c => c.ok), JSON.stringify(body.checks.filter(c => !c.ok)));
});
