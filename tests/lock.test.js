const test = require('node:test');
const assert = require('node:assert/strict');
const lock = require('../lib/lock');
const { lockPlays } = require('../lib/slate');

const game = (id, state, start) => ({ id, state, date: start, home: { id: id + 'h', name: 'H' + id, div: 'fbs' }, away: { id: id + 'a', name: 'A' + id, div: 'fbs' }, model: { margin: 7, total: 50 }, pick: { team: { id: id + 'h', name: 'H' + id }, prob: 0.8, tier: null, sharp: false, risk: false, count: 3, flags: [], marketGap: null } });
const lists = n => ({ best: { gameId: 'g' + n }, parlays: [{ legs: 3 }], sharp: [], board: [], risks: [] });

test('hasStarted: the feed or the clock, whichever comes first', () => {
  const now = Date.parse('2026-11-07T20:00:00Z');
  assert.equal(lock.hasStarted([{ state: 'pre', date: '2026-11-07T21:00:00Z' }], now), false);
  assert.equal(lock.hasStarted([{ state: 'pre', date: '2026-11-07T19:30:00Z' }], now), true, 'kickoff time passed, feed still says pre');
  assert.equal(lock.hasStarted([{ state: 'in', date: '2026-11-07T23:00:00Z' }], now), true);
});

test('lockPlays: draft before kickoff, sealed lists after, failed database writes nothing', async () => {
  const calls = [], real = { draft: lock.draft, seal: lock.seal };
  let stored = null, down = false;
  lock.draft = async (t, d, p) => { calls.push('draft'); stored = { payload: p, sealed: false }; return { state: 'open' }; };
  lock.seal = async (t, d, c) => { calls.push('seal'); if (down) return { state: 'unconfirmed' }; if (stored) { stored.sealed = true; return { state: 'locked', payload: stored.payload }; } stored = { payload: c, sealed: true }; return { state: 'late', payload: c }; };
  try {
    const future = new Date(Date.now() + 864e5).toISOString(), past = new Date(Date.now() - 3600e3).toISOString();
    const pre = await lockPlays('d', [game('1', 'pre', future)], lists(1));
    assert.equal(pre.lock.state, 'open'); assert.equal(stored.payload.games.length, 1, 'every game saved for the Accuracy tab');
    const after = await lockPlays('d', [game('1', 'pre', past)], lists(2));
    assert.equal(after.lock.state, 'locked'); assert.equal(after.best.gameId, 'g1', 'the sealed pick, not today’s rebuild');
    down = true; const flaky = await lockPlays('d', [game('1', 'in', past)], lists(3));
    assert.equal(flaky.lock.state, 'unconfirmed'); assert.equal(stored.payload.best.gameId, 'g1', 'nothing overwritten');
    stored = null; down = false;
    const late = await lockPlays('d2', [game('1', 'in', past), game('2', 'pre', future)], lists(4));
    assert.equal(late.lock.state, 'late'); assert.deepEqual(stored.payload.games.map(g => g.id), ['2'], 'a late lock tracks only games not yet started');
    assert.deepEqual(calls, ['draft', 'seal', 'seal', 'seal']);
  } finally { Object.assign(lock, real); }
});
