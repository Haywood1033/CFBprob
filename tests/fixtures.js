// tests/fixtures.js — a synthetic college football world served through a mocked fetch, in the
// shapes the real sources return: cfbfastR-data schedule CSVs (raw GitHub), ESPN scoreboards (by day
// and by week) and Open-Meteo geocoding and forecasts. Teams have true strengths and home cities;
// 2025 is a full season, 2026 is played through week 9, and week 10 (Saturday 2026-11-07) is the
// slate. Deterministic (seeded).

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

const CITIES = [
  ['Tuscaloosa', 'AL', 33.21, -87.57], ['Athens', 'GA', 33.96, -83.38], ['Columbus', 'OH', 39.96, -83.0], ['Ann Arbor', 'MI', 42.28, -83.74],
  ['Austin', 'TX', 30.27, -97.74], ['Eugene', 'OR', 44.05, -123.09], ['Seattle', 'WA', 47.61, -122.33], ['Los Angeles', 'CA', 34.05, -118.24],
  ['Baton Rouge', 'LA', 30.45, -91.15], ['Gainesville', 'FL', 29.65, -82.32], ['Norman', 'OK', 35.22, -97.44], ['Lincoln', 'NE', 40.81, -96.7],
  ['Madison', 'WI', 43.07, -89.4], ['State College', 'PA', 40.79, -77.86], ['Clemson', 'SC', 34.68, -82.84], ['Tempe', 'AZ', 33.43, -111.94],
  ['Boise', 'ID', 43.62, -116.2], ['Provo', 'UT', 40.23, -111.66], ['Syracuse', 'NY', 43.05, -76.15], ['Iowa City', 'IA', 41.66, -91.53],
  ['Lubbock', 'TX', 33.58, -101.86], ['Orlando', 'FL', 28.54, -81.38], ['Boulder', 'CO', 40.01, -105.27], ['Knoxville', 'TN', 35.96, -83.92],
  ['Bozeman', 'MT', 45.68, -111.04], ['Fargo', 'ND', 46.88, -96.79], ['Harrisonburg', 'VA', 38.45, -78.87], ['Nacogdoches', 'TX', 31.6, -94.66],
];
const DOMES = new Set(['Syracuse']); // indoor stadium
const WINDY = new Set(['Lubbock']);  // 22 mph on the slate day

function makeWorld({ seed = 7 } = {}) {
  const r = rng(seed);
  const teams = CITIES.map(([city, st, lat, lon], i) => ({ id: String(1000 + i), name: `${city} ${['Hawks', 'Bears', 'Lions', 'Wolves'][i % 4]}`, abbrev: city.replace(/[^A-Z]/g, '').slice(0, 3) + i, city, st, lat, lon, div: i < 24 ? 'fbs' : 'fcs', conf: i < 24 ? ['East', 'West', 'North'][i % 3] : 'FCS', off: (i < 24 ? 0 : -12) + (r() - 0.5) * 18, def: (i < 24 ? 0 : -12) + (r() - 0.5) * 18 }));
  const games = [];
  const play = (h, a, season, week, date, neutral = false) => {
    const mu = 28, hf = neutral ? 0 : 1.5;
    const hp = Math.max(0, Math.round(mu + h.off - a.def + hf + (r() - 0.5) * 30)), ap = Math.max(0, Math.round(mu + a.off - h.def - hf + (r() - 0.5) * 30));
    return { id: String(400000000 + games.length), season, week, date, neutral, home: h, away: a, hp: hp === ap ? hp + 3 : hp, ap };
  };
  const day0 = { 2025: Date.parse('2025-08-30T19:30:00Z'), 2026: Date.parse('2026-08-29T19:30:00Z') };
  for (const season of [2025, 2026]) {
    for (let week = 1; week <= 12; week++) {
      const fbs = teams.filter(t => t.div === 'fbs');
      const order = [...fbs].sort(() => r() - 0.5);
      const date = new Date(day0[season] + (week - 1) * 7 * 864e5).toISOString().replace('.000', '');
      for (let k = 0; k + 1 < order.length; k += 2) {
        let h = order[k], a = order[k + 1];
        if (week <= 2 && k < 8) a = teams[24 + (k / 2) % 4]; // early-season FCS opponents
        games.push({ ...play(h, a, season, week, date, week === 5 && k === 0), state: season === 2026 && week >= 10 ? 'pre' : 'post' });
      }
    }
  }
  for (const g of games) if (g.state === 'pre') { g.hp = null; g.ap = null; }
  games.find(g => g.season === 2026 && g.week === 11).dome = true; // one slate game indoors
  return { teams, games, today: '2026-11-07' };
}

const csvCell = v => (v === null || v === undefined ? 'NA' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
function scheduleCsv(world, season) {
  const head = ['game_id', 'season', 'week', 'season_type', 'start_date', 'start_time_tbd', 'completed', 'neutral_site', 'conference_game', 'attendance', 'venue_id', 'venue', 'home_id', 'home_team', 'home_division', 'home_conference', 'home_points', 'away_id', 'away_team', 'away_division', 'away_conference', 'away_points', 'notes'];
  // cfbfastR-data lags: the latest completed week isn't in it yet (ESPN fills it in).
  const rows = world.games.filter(g => g.season === season).map(g => {
    const lag = season === 2026 && g.week === 9;
    return [g.id, g.season, g.week, 'regular', g.date.replace('Z', '.000Z'), 'FALSE', g.state === 'post' && !lag ? 'TRUE' : 'FALSE', g.neutral ? 'TRUE' : 'FALSE', 'FALSE', null, null, `${g.home.city} Stadium`, g.home.id, g.home.name, g.home.div, g.home.conf, lag ? null : g.hp, g.away.id, g.away.name, g.away.div, g.away.conf, lag ? null : g.ap, g.neutral ? 'Kickoff Classic, "neutral"' : null];
  });
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n';
}

function espnEvent(g) {
  const comp = (t, homeAway, score) => ({ homeAway, score: score === null ? '0' : String(score), team: { id: t.id, location: t.name, displayName: t.name, shortDisplayName: t.name.split(' ')[0], abbreviation: t.abbrev, logo: `https://a.espncdn.com/i/teamlogos/ncaa/500/${t.id}.png`, color: '336699' }, curatedRank: { current: 99 }, records: [{ type: 'total', summary: '5-3' }] });
  const v = g.neutral ? CITIES[17] : [g.home.city, g.home.st];
  return {
    id: g.id, date: g.date, season: { year: g.season, type: 2 }, week: { number: g.week },
    competitions: [{ neutralSite: g.neutral, conferenceCompetition: false, venue: { fullName: `${v[0]} Stadium`, indoor: DOMES.has(v[0]) || !!g.dome, address: { city: v[0], state: v[1] } },
      competitors: [comp(g.home, 'home', g.hp), comp(g.away, 'away', g.ap)], broadcasts: [{ names: ['ESPN'] }],
      status: { period: g.state === 'post' ? 4 : 0, displayClock: '0:00', type: { state: g.state, completed: g.state === 'post', shortDetail: g.state === 'post' ? 'Final' : 'Sat 3:30 PM' } } }],
  };
}

function installMockFetch(opts = {}) {
  const world = makeWorld(opts), real = global.fetch, calls = [];
  const json = b => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
  global.fetch = async (url) => {
    const u = new URL(String(url)); calls.push(u.href);
    if (u.hostname === 'raw.githubusercontent.com') {
      const m = u.pathname.match(/cfb_schedules_(\d{4})\.csv$/);
      if (m && [2025, 2026].includes(Number(m[1]))) { const t = scheduleCsv(world, Number(m[1])); return { ok: true, status: 200, text: async () => t }; }
      return { ok: false, status: 404, text: async () => '404' };
    }
    if (u.hostname === 'site.api.espn.com') {
      const p = u.searchParams, dates = p.get('dates') || '';
      let gs;
      if (dates.length === 8) gs = world.games.filter(g => g.date.slice(0, 10).replace(/-/g, '') === dates);
      else if (p.get('seasontype') === '3') gs = [];
      else gs = world.games.filter(g => String(g.season) === dates && String(g.week) === p.get('week'));
      return json({ events: gs.map(espnEvent) });
    }
    if (u.hostname === 'geocoding-api.open-meteo.com') {
      const c = CITIES.find(x => x[0] === u.searchParams.get('name'));
      const names = { AL: 'Alabama', GA: 'Georgia', OH: 'Ohio', MI: 'Michigan', TX: 'Texas', OR: 'Oregon', WA: 'Washington', CA: 'California', LA: 'Louisiana', FL: 'Florida', OK: 'Oklahoma', NE: 'Nebraska', WI: 'Wisconsin', PA: 'Pennsylvania', SC: 'South Carolina', AZ: 'Arizona', ID: 'Idaho', UT: 'Utah', NY: 'New York', IA: 'Iowa', CO: 'Colorado', TN: 'Tennessee', MT: 'Montana', ND: 'North Dakota', VA: 'Virginia' };
      return json({ results: c ? [{ name: c[0], latitude: c[2], longitude: c[3], country_code: 'US', admin1: names[c[1]] }] : [] });
    }
    if (u.hostname === 'api.open-meteo.com') {
      const lat = Number(u.searchParams.get('latitude')), c = CITIES.find(x => Math.abs(x[2] - lat) < 0.01);
      const start = Date.parse(`${u.searchParams.get('start_date') || '2026-11-07'}T00:00:00Z`), time = Array.from({ length: 48 }, (_, i) => new Date(start + i * 3600e3).toISOString().slice(0, 16));
      const windy = c && WINDY.has(c[0]);
      return json({ hourly: { time, temperature_2m: time.map(() => 55), precipitation: time.map(() => 0), wind_speed_10m: time.map(() => (windy ? 22 : 6)), wind_gusts_10m: time.map(() => (windy ? 35 : 12)) } });
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  return { world, calls, restore() { global.fetch = real; } };
}

module.exports = { makeWorld, installMockFetch, scheduleCsv, espnEvent, CITIES };
