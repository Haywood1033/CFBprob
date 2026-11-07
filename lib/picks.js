// lib/picks.js — the model's pick in each game, the signals behind it, the day's best play and the
// best 3-, 4- and 5-leg parlays. Every input is data (ratings from results, home field, rest,
// travel, weather); nothing is read from a betting line.
//
// Signals, each on the team the model picks (the same idea as the other apps' tags):
//   🏆 Power gap        75%+ to win
//   🏟 Home field       at home, not a neutral site
//   ⚔️ Offense edge      projected 34+ points against this defense
//   🛡 Defense edge      holds this offense to 17 or fewer projected
//   🔥 Form             last 3 games' margin 7+ points better than its season average
//   😴 Rest edge        off a bye while the opponent isn't, or the opponent is on a short week
//   ✈️ Travel edge       the opponent flies 1,000+ miles or crosses 2+ time zones
//   🌤 Clean conditions  a dome or no wind, rain or deep cold (less randomness for the better team)
// Tags: Elite 6+, All-Star 5, Value 4.
//
// Backtested on 2,106 FBS-vs-FBS games (2024 – 2026 week 9, ratings from earlier games only;
// travel and weather weren't in the historical data): picks with 3 signals won 87%, 4 won 90%;
// Defense edge was the one signal that added to the model's own chance (+2 points).
//
// Best play: a "sharp" pick first (power gap + defense edge + home, rest or travel), then the most
// signals, then the chance. Parlays take the next best picks, one per game. Games against FCS
// opponents are left out of both (near-certain, nothing to learn).

const SIGNALS = [
  { key: 'power', icon: '🏆', label: 'Power gap' },
  { key: 'home', icon: '🏟', label: 'Home field' },
  { key: 'offense', icon: '⚔️', label: 'Offense edge' },
  { key: 'defense', icon: '🛡', label: 'Defense edge' },
  { key: 'form', icon: '🔥', label: 'Form' },
  { key: 'rest', icon: '😴', label: 'Rest edge' },
  { key: 'travel', icon: '✈️', label: 'Travel edge' },
  { key: 'clean', icon: '🌤', label: 'Clean conditions' },
];
const TIERS = [{ name: 'Elite', min: 6 }, { name: 'All-Star', min: 5 }, { name: 'Value', min: 4 }];
const tierRank = t => ({ Elite: 3, 'All-Star': 2, Value: 1 }[t] || 0);

// Last-3 margin vs season average for a team, from this season's results before `iso`.
function form(results, id, iso) {
  const gs = results.filter(g => (g.home.id === id || g.away.id === id) && g.date < iso).sort((a, b) => a.date.localeCompare(b.date));
  if (gs.length < 5) return null;
  const m = g => (g.home.id === id ? g.hp - g.ap : g.ap - g.hp);
  const avg = a => a.reduce((s, g) => s + m(g), 0) / a.length;
  return { last3: avg(gs.slice(-3)), season: avg(gs), diff: avg(gs.slice(-3)) - avg(gs), streak: gs.slice(-3).map(g => (m(g) > 0 ? 'W' : 'L')).join('') };
}

// pred: lib/ratings predict(); cond: lib/conditions; game: slate game.
function pickFor(game, pred, cond, results) {
  const homePick = pred.pHome >= 0.5, side = homePick ? 'home' : 'away', opp = homePick ? 'away' : 'home';
  const me = game[side], op = game[opp], prob = homePick ? pred.pHome : 1 - pred.pHome;
  const ptsFor = homePick ? pred.ph : pred.pa, ptsAg = homePick ? pred.pa : pred.ph;
  const f = form(results, me.id, game.date);
  const rMe = cond?.rest?.[side], rOp = cond?.rest?.[opp];
  const trOp = cond?.travel?.[opp], trMe = cond?.travel?.[side];
  const wx = cond?.weather;
  const on = {
    power: [prob >= 0.75, `${Math.round(prob * 100)}% to win`],
    home: [homePick && !game.neutral, game.neutral ? 'neutral site' : homePick ? `at home (worth about ${pred.homeField.toFixed(1)} points)` : 'on the road'],
    offense: [ptsFor >= 34, `projected ${ptsFor.toFixed(0)} points against this defense`],
    defense: [ptsAg <= 17, `holds them to ${ptsAg.toFixed(0)} projected`],
    form: [!!f && f.diff >= 7, f ? `last 3: ${f.last3 >= 0 ? '+' : ''}${f.last3.toFixed(0)} a game vs ${f.season >= 0 ? '+' : ''}${f.season.toFixed(0)} on the season (${f.streak})` : 'fewer than 5 games'],
    rest: [rMe !== null && rOp !== null && ((rMe >= 13 && rOp < 13) || (rOp <= 5 && rMe > 5)), rMe !== null && rOp !== null ? `${rMe} days' rest vs ${rOp}` : 'rest unknown'],
    travel: [!!trOp && ((trOp.miles ?? 0) - (trMe?.miles ?? 0) >= 1000 || (trOp.zones ?? 0) - (trMe?.zones ?? 0) >= 2), trOp?.miles != null ? `${op.short || op.name} travel ${trOp.miles.toLocaleString()} miles${trOp.zones ? `, ${trOp.zones} time zone${trOp.zones === 1 ? '' : 's'}` : ''}` : 'travel unknown'],
    clean: [!!wx && (wx.dome || !wx.effect?.notes?.length), !wx ? 'no forecast' : wx.dome ? 'indoors' : wx.effect?.notes?.length ? wx.effect.notes.join(', ') : `${wx.temp}°F, ${wx.wind} mph wind`],
  };
  const signals = SIGNALS.map(s => ({ ...s, on: !!on[s.key][0], detail: on[s.key][1] }));
  const count = signals.filter(s => s.on).length;
  const tier = TIERS.find(t => count >= t.min)?.name || null;
  const sharp = on.power[0] && on.defense[0] && (on.home[0] || on.rest[0] || on.travel[0]);
  return { side, team: me, opp: op, prob, margin: homePick ? pred.margin : -pred.margin, ptsFor, ptsAg, signals, count, tier, sharp, form: f };
}

// Best play first, then by signals, then chance.
const order = (a, b) => (b.sharp - a.sharp) || (b.count - a.count) || (b.prob - a.prob);
// Started games stay in: ratings are fixed as of the morning, so a game starting changes nothing.
const eligible = g => g.home.div === 'fbs' && g.away.div === 'fbs';

function bestAndParlays(games) {
  const pool = games.filter(eligible).map(g => ({ game: g, pick: g.pick })).sort((a, b) => order(a.pick, b.pick));
  const best = pool[0] || null;
  const parlays = [3, 4, 5].map(n => {
    if (pool.length < n) return { legs: n, available: false };
    const legs = pool.slice(0, n);
    const joint = legs.reduce((p, x) => p * x.pick.prob, 1);
    return { legs: n, available: true, joint, picks: legs.map(x => ({ gameId: x.game.id, team: x.pick.team, opp: x.pick.opp, prob: x.pick.prob, tier: x.pick.tier, sharp: x.pick.sharp, count: x.pick.count, start: x.game.date })) };
  });
  return { best: best ? { gameId: best.game.id, ...best.pick } : null, parlays, pool: pool.length };
}

module.exports = { SIGNALS, TIERS, tierRank, form, pickFor, bestAndParlays, eligible, order };
