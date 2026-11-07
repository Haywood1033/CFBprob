// lib/ratings.js — opponent-adjusted offense and defense ratings from final scores, no betting data.
//
//   points for the home team = μ + O[home] − D[away] + H/2      (H = 0 at a neutral site)
//   points for the away team = μ + O[away] − D[home] − H/2
//
// O is how many points a team scores above an average offense would against the same defense; D how
// many it holds an average offense under. Fitted by weighted least squares with a ridge pull toward
// a prior (last season's rating carried over in part), so early-season ratings lean on last year
// and fade into this year's results as games are played. Recent games count more (half-life), and
// blowouts are capped (a 63–0 win says little more than 35–0). FBS and FCS teams get their own
// level (an FCS team isn't assumed average just because it hasn't played many FBS teams).

const P = {
  cap: 31,          // margin beyond this counts at `excess` weight
  excess: 0.25,
  lambda: 2,        // ridge strength, in games' worth of evidence toward the prior
  carry: 0.7,       // share of last season's rating carried into this one
  halfLifeDays: 365, // recency weighting (tuning found little gain from fading early games)
  sigma: 14,        // win chance = Φ(margin / sigma), fitted on 2024 log loss
  sigmaTotal: 14,
  iterations: 40,
};

const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
const divOf = d => (d === 'fbs' || d === 'fcs' ? d : 'other');

// The capped score: keeps the total, shrinks the margin past `cap`.
function capped(g, p = P) {
  const m = g.hp - g.ap, t = g.hp + g.ap, a = Math.abs(m);
  const m2 = a <= p.cap ? m : Math.sign(m) * (p.cap + (a - p.cap) * p.excess);
  return { h: (t + m2) / 2, a: (t - m2) / 2 };
}

// games: completed games (any order). asOf: ISO date; only games before it count.
// prior: Map(teamId -> { o, d }) means for the ridge (default 0).
function fitRatings(games, asOf, { prior = null, params = {} } = {}) {
  const p = { ...P, ...params };
  const gs = games.filter(g => g.completed && g.hp !== null && g.date < asOf);
  const teams = new Map(); // id -> { o, d, div, name, conf, n }
  const T = (side) => {
    let t = teams.get(side.id);
    if (!t) { const pr = prior?.get(side.id); t = { id: side.id, o: pr?.o || 0, d: pr?.d || 0, po: pr?.o || 0, pd: pr?.d || 0, div: divOf(side.div), name: side.name, conf: side.conf, n: 0 }; teams.set(side.id, t); }
    if (side.conf) t.conf = side.conf;
    return t;
  };
  // Recency is measured from the cutoff, or from the last game when the cutoff is far past it.
  const ref = gs.reduce((m, g) => (g.date > m ? g.date : m), '') || asOf, wref = asOf < ref ? asOf : ref;
  const rows = gs.map(g => { const c = capped(g, p); const h = T(g.home), a = T(g.away); h.n++; a.n++; return { h, a, yh: c.h, ya: c.a, home: g.neutral ? 0 : 1, w: Math.pow(0.5, Math.max(0, daysBetween(g.date, wref)) / p.halfLifeDays) }; });
  // Teams with no games yet still get their prior rating.
  if (prior) for (const [id, pr] of prior) if (!teams.has(id)) teams.set(id, { id, o: pr.o, d: pr.d, po: pr.o, pd: pr.d, div: pr.div || 'fbs', name: pr.name, conf: pr.conf, n: 0 });
  let mu = rows.length ? rows.reduce((s, r) => s + r.w * (r.yh + r.ya), 0) / rows.reduce((s, r) => s + 2 * r.w, 0) : 28, H = 2.5;
  const lvl = { fbs: { o: 0, d: 0 }, fcs: { o: -10, d: -10 }, other: { o: -18, d: -18 } };
  const O = t => lvl[t.div].o + t.o, D = t => lvl[t.div].d + t.d;
  for (let it = 0; it < p.iterations && rows.length; it++) {
    // μ and home field
    let s = 0, w = 0, sh = 0, wh = 0;
    for (const r of rows) {
      const ph = O(r.h) - D(r.a), pa = O(r.a) - D(r.h);
      s += r.w * (r.yh - ph - r.home * H / 2 + r.ya - pa + r.home * H / 2); w += 2 * r.w;
      if (r.home) { sh += r.w * ((r.yh - mu - ph) - (r.ya - mu - pa)); wh += r.w; }
    }
    mu = s / w; if (wh) H = sh / wh;
    // division levels (FBS fixed at 0): mean residual of their teams' games against other divisions
    for (const dv of ['fcs', 'other']) {
      let so = 0, sd = 0, wo = 0, wd = 0;
      for (const r of rows) for (const [me, op, y, sign] of [[r.h, r.a, r.yh, 1], [r.a, r.h, r.ya, -1]]) {
        if (me.div === dv && op.div !== dv) { so += r.w * (y - (mu + O(me) - D(op) + sign * r.home * H / 2)); wo += r.w; }
        if (op.div === dv && me.div !== dv) { sd += r.w * (y - (mu + O(me) - D(op) + sign * r.home * H / 2)); wd += r.w; }
      }
      if (wo) lvl[dv].o += so / wo / 2;
      if (wd) lvl[dv].d -= sd / wd / 2;
    }
    // each team's offense and defense, pulled toward its prior
    const acc = new Map();
    const add = (t, k, v, wt) => { const a = acc.get(t.id) || { o: 0, ow: 0, d: 0, dw: 0 }; a[k] += wt * v; a[k + 'w'] += wt; acc.set(t.id, a); };
    for (const r of rows) for (const [me, op, y, sign] of [[r.h, r.a, r.yh, 1], [r.a, r.h, r.ya, -1]]) {
      const base = mu + sign * r.home * H / 2;
      add(me, 'o', y - (base + lvl[me.div].o - D(op)), r.w);   // what his offense alone has to explain
      add(op, 'd', (base + O(me) - lvl[op.div].d) - y, r.w);   // what the defense held them under
    }
    for (const t of teams.values()) {
      const a = acc.get(t.id); if (!a) continue;
      t.o = (a.o + p.lambda * t.po) / (a.ow + p.lambda);
      t.d = (a.d + p.lambda * t.pd) / (a.dw + p.lambda);
    }
  }
  for (const t of teams.values()) { t.off = O(t); t.def = D(t); t.rating = t.off + t.def; }
  return { asOf, mu, H, lvl, teams, games: gs.length, params: p };
}

// Last season's ratings → this season's prior (deviations carried over in part).
function carryPrior(prev, carry = P.carry) {
  const m = new Map();
  for (const t of prev.teams.values()) m.set(t.id, { o: t.o * carry, d: t.d * carry, div: t.div, name: t.name, conf: t.conf });
  return m;
}

const erf = x => { const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)); };
const phi = z => 0.5 * (1 + erf(z / Math.SQRT2));

// A team with no rating at all (a lower-division opponent never seen): its division's level.
function teamOrDefault(R, side) {
  return R.teams.get(side.id) || { id: side.id, name: side.name, conf: side.conf, div: divOf(side.div), off: R.lvl[divOf(side.div)].o, def: R.lvl[divOf(side.div)].d, rating: R.lvl[divOf(side.div)].o + R.lvl[divOf(side.div)].d, n: 0, unrated: true };
}

// Projected score, margin (home − away), total and win chance. adj: points added to the home
// margin and to the total by game conditions (lib/conditions: rest, travel, weather).
function predict(R, home, away, { neutral = false, adj = { margin: 0, total: 0 }, params = {} } = {}) {
  const p = { ...R.params, ...params };
  const h = teamOrDefault(R, home), a = teamOrDefault(R, away);
  const hf = neutral ? 0 : R.H / 2;
  let ph = R.mu + h.off - a.def + hf, pa = R.mu + a.off - h.def - hf;
  ph += (adj.margin || 0) / 2 + (adj.total || 0) / 2; pa += -(adj.margin || 0) / 2 + (adj.total || 0) / 2;
  ph = Math.max(0, ph); pa = Math.max(0, pa);
  const margin = ph - pa, total = ph + pa;
  return { home: h, away: a, ph, pa, margin, total, pHome: phi(margin / p.sigma), homeField: neutral ? 0 : R.H, sigma: p.sigma };
}

module.exports = { P, fitRatings, carryPrior, predict, phi, capped, teamOrDefault, daysBetween };
