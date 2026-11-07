// lib/espn.js — ESPN's public college football scoreboard: the day's slate (teams, ranks, records,
// logos, venue, kickoff, live and final scores) and this season's completed games, which fill in
// the days cfbfastR-data hasn't caught up on yet. No betting data is read.
//
// Event → the lib/history game shape, plus the display fields the slate needs.

const { fetchJson, mapLimit, TTL } = require('./http');

const SB = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard';
const num = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

function side(c, fbs) {
  const t = c.team || {};
  const rec = (c.records || []).find(r => r.type === 'total' || r.name === 'overall') || (c.records || [])[0];
  const rank = num(c.curatedRank?.current);
  return {
    id: String(t.id), name: t.location || t.displayName || t.shortDisplayName, display: t.displayName || t.location, short: t.shortDisplayName || t.abbreviation || t.location,
    abbrev: t.abbreviation || '', logo: t.logo || (t.logos && t.logos[0]?.href) || null, color: t.color ? `#${t.color}` : null,
    rank: rank && rank <= 25 ? rank : null, record: rec?.summary || null, conf: null,
    div: fbs && fbs.size ? (fbs.has(String(t.id)) ? 'fbs' : 'fcs') : null,
    score: num(c.score),
  };
}

function parseEvent(ev, fbs) {
  const c = ev.competitions?.[0]; if (!c) return null;
  const home = c.competitors?.find(x => x.homeAway === 'home'), away = c.competitors?.find(x => x.homeAway === 'away');
  if (!home || !away) return null;
  const st = c.status?.type || ev.status?.type || {};
  const v = c.venue || {};
  const H = side(home, fbs), A = side(away, fbs);
  const state = st.state === 'in' ? 'in' : st.state === 'post' || st.completed ? 'post' : 'pre';
  return {
    id: String(ev.id), season: num(ev.season?.year), week: num(ev.week?.number), seasonType: ev.season?.type === 3 ? 'postseason' : 'regular',
    date: ev.date, neutral: !!c.neutralSite, completed: !!st.completed, state, status: st.shortDetail || st.detail || '',
    period: num(c.status?.period), clock: c.status?.displayClock || null,
    venue: v.fullName || null, indoor: v.indoor === true, city: v.address?.city || null, stateCode: v.address?.state || null,
    broadcast: c.broadcasts?.[0]?.names?.[0] || null, conferenceGame: !!c.conferenceCompetition,
    home: H, away: A, hp: state === 'post' ? H.score : null, ap: state === 'post' ? A.score : null,
    notes: (c.notes || []).map(n => n.headline).filter(Boolean)[0] || null,
  };
}

// One day's games (ET date YYYY-MM-DD), every game with an FBS team.
async function fetchDay(date, { fbs = null, live = false } = {}) {
  const raw = await fetchJson(`${SB}?groups=80&limit=400&dates=${date.replace(/-/g, '')}`, { ttlMs: live ? 45 * 1000 : 5 * 60 * 1000, timeoutMs: 12000 });
  return (raw.events || []).map(e => parseEvent(e, fbs)).filter(Boolean);
}

// This season's completed regular-season and bowl games, week by week.
async function fetchSeasonResults(season, { fbs = null, weeks = 16 } = {}) {
  const urls = [...Array.from({ length: weeks }, (_, i) => `${SB}?groups=80&limit=400&seasontype=2&week=${i + 1}&dates=${season}`), `${SB}?groups=80&limit=400&seasontype=3&dates=${season}`];
  const pages = await mapLimit(urls, 6, u => fetchJson(u, { ttlMs: TTL.long, timeoutMs: 12000, retries: 0 }).catch(() => null));
  const out = new Map();
  for (const p of pages) for (const e of p?.events || []) { const g = parseEvent(e, fbs); if (g && g.state === 'post' && g.hp !== null) out.set(g.id, g); }
  return [...out.values()];
}

module.exports = { fetchDay, fetchSeasonResults, parseEvent, SB };
