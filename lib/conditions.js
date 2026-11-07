// lib/conditions.js — what surrounds a game beyond the two teams' ratings:
//   rest     days since each team's last game (a bye week, a short week)
//   travel   how far the visiting team flies, and how many time zones (stadium to stadium)
//   weather  the kickoff-hour forecast at the stadium (Open-Meteo; a dome is a dome)
// Locations come from Open-Meteo's geocoder by city and state; each team's home is the stadium of
// its home games this season. All free, no keys, no betting data.

const { fetchJson, mapLimit, TTL } = require('./http');

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const WX = 'https://api.open-meteo.com/v1/forecast';
const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
const geoMemo = new Map();

async function geocode(city, state) {
  if (!city) return null;
  const key = `${city}|${state || ''}`;
  if (geoMemo.has(key)) return geoMemo.get(key);
  const p = (async () => {
    const r = await fetchJson(`${GEO}?name=${encodeURIComponent(city)}&count=10&language=en&format=json`, { ttlMs: TTL.long, timeoutMs: 8000 });
    const want = STATES[String(state || '').toUpperCase()] || state;
    const hit = (r.results || []).find(x => x.country_code === 'US' && (!want || x.admin1 === want)) || (r.results || []).find(x => x.country_code === 'US') || (r.results || [])[0];
    return hit ? { lat: hit.latitude, lon: hit.longitude, tz: hit.timezone || null } : null;
  })().catch(() => null);
  geoMemo.set(key, p);
  return p;
}

function miles(a, b) {
  if (!a || !b) return null;
  const R = 3958.8, rad = x => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Kickoff-hour forecast. → { temp °F, wind mph, precip in/hr, dome } | null
async function weatherAt(loc, iso) {
  if (!loc) return null;
  const day = iso.slice(0, 10);
  const r = await fetchJson(`${WX}?latitude=${loc.lat}&longitude=${loc.lon}&hourly=temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=UTC&start_date=${day}&end_date=${new Date(Date.parse(iso) + 4 * 3600e3).toISOString().slice(0, 10)}`, { ttlMs: 30 * 60 * 1000, timeoutMs: 8000 });
  const h = r.hourly; if (!h?.time?.length) return null;
  const k = Date.parse(iso), idx = h.time.map(t => Math.abs(Date.parse(`${t}:00Z`) - k)).reduce((bi, d, i, a) => (d < a[bi] ? i : bi), 0);
  const span = [idx, idx + 1, idx + 2, idx + 3].filter(i => i < h.time.length); // the game's first ~3 hours
  const avg = k2 => span.reduce((s, i) => s + (h[k2][i] ?? 0), 0) / span.length;
  return { temp: Math.round(avg('temperature_2m')), wind: Math.round(avg('wind_speed_10m')), gust: Math.round(Math.max(...span.map(i => h.wind_gusts_10m?.[i] ?? 0))), precip: +avg('precipitation').toFixed(2) };
}

// Model adjustments for the weather (points off the projected total; margins are left alone).
// Judgment, not fitted (no historical weather in the data): wind and rain cut passing and scoring.
function weatherEffect(w) {
  if (!w || w.dome) return { total: 0, adverse: false, notes: [] };
  const notes = []; let total = 0;
  if (w.wind >= 20) { total -= 4; notes.push(`${w.wind} mph wind`); } else if (w.wind >= 15) { total -= 2.5; notes.push(`${w.wind} mph wind`); }
  if (w.precip >= 0.1) { total -= 2.5; notes.push('rain or snow'); } else if (w.precip >= 0.03) { total -= 1; notes.push('light rain'); }
  if (w.temp <= 25) { total -= 1.5; notes.push(`${w.temp}°F`); }
  return { total, adverse: total <= -2.5, notes };
}

// Days since each team's previous game (from this season's results).
function restDays(results, teamId, iso) {
  let last = null;
  for (const g of results) if ((g.home.id === teamId || g.away.id === teamId) && g.date < iso && (!last || g.date > last)) last = g.date;
  return last ? Math.round((Date.parse(iso) - Date.parse(last)) / 864e5) : null;
}

// Each team's home stadium city: its most common non-neutral home venue this season.
function homeCities(results) {
  const m = new Map();
  for (const g of results) {
    if (g.neutral || !g.city) continue;
    const k = g.home.id, c = m.get(k) || new Map(), key = `${g.city}|${g.stateCode || ''}`;
    c.set(key, (c.get(key) || 0) + 1); m.set(k, c);
  }
  return new Map([...m].map(([id, c]) => { const [city, st] = [...c].sort((a, b) => b[1] - a[1])[0][0].split('|'); return [id, { city, state: st }]; }));
}

// Conditions for every game on a slate. games: lib/espn day games; results: this season's results
// (with venue cities) for rest and home stadiums.
async function conditionsFor(games, results) {
  const homes = homeCities(results);
  return mapLimit(games, 6, async g => {
    const venue = await geocode(g.city, g.stateCode);
    const awayHome = homes.get(g.away.id), homeHome = homes.get(g.home.id);
    const [aLoc, hLoc] = await Promise.all([awayHome ? geocode(awayHome.city, awayHome.state) : null, homeHome ? geocode(homeHome.city, homeHome.state) : null]);
    const tzGap = (a, b) => (a && b ? Math.round(Math.abs(a.lon - b.lon) / 15) : null);
    let wx = null;
    if (g.indoor) wx = { dome: true };
    else wx = await weatherAt(venue, g.date).catch(() => null); // started games too, so their pick doesn't change
    const eff = weatherEffect(wx);
    return {
      rest: { home: restDays(results, g.home.id, g.date), away: restDays(results, g.away.id, g.date) },
      travel: { away: { miles: aLoc && venue ? Math.round(miles(aLoc, venue)) : null, zones: tzGap(aLoc, venue) }, home: { miles: g.neutral && hLoc && venue ? Math.round(miles(hLoc, venue)) : 0, zones: g.neutral ? tzGap(hLoc, venue) : 0 } },
      weather: wx ? { ...wx, effect: eff } : null,
      adj: { margin: 0, total: eff.total },
    };
  });
}

module.exports = { conditionsFor, geocode, weatherAt, weatherEffect, restDays, homeCities, miles, STATES };
