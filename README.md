# cfbprob

College football: the model's pick in every game, the **best play of the day**, and the **best 3-, 4- and 5-leg parlays**. Built from data only — no betting lines are read anywhere.

## What goes into a pick
- **Team ratings** — opponent-adjusted offense and defense from final scores (`lib/ratings.js`): this season's results, with 70% of last season carried in early, blowouts capped, FBS and FCS on their own levels. Home field is fitted each season and pulled toward a long-run 3 points (worth 300 games of evidence): 2023–25 fitted 1.9–2.6 points, 2026 alone 4.6, and the pull improved the replay's 2026 log loss from 0.482 to 0.477.
- **Conditions** (`lib/conditions.js`) — days of rest (bye weeks, short weeks), how far the visitor travels and how many time zones (stadiums geocoded with Open-Meteo), and the kickoff forecast (wind, rain, cold lower the projected total; a dome is a dome).
- **Signals** (`lib/picks.js`) — eight data points on the team the model picks: 🏆 power gap, 🏟 home field, ⚔️ offense edge, 🛡 defense edge, 🔥 form, 😴 rest edge, ✈️ travel edge, 🌤 clean conditions. Tags: Elite 6+, All-Star 5, Value 4.
- **Best play** — a *sharp* pick first (power gap + defense edge + home, rest or travel), then the most signals, then the highest chance.
- **Best plays tab** — up to 5 sharp plays, the board of every All-Star and Elite pick, and **Risks & fades**: favorites (60%+) with 2+ red flags (on the road, opponent off a bye, defense projected to allow 28+, travel to a neutral site, bad weather). On 1,559 real favorites, 2+ of the tested flags cost about 3 points of win rate, 3+ about 5.
- **Parlays** take the next best picks, one per game, FBS vs FBS only, with flagged favorites left out. Everything locks at the first kickoff with a database.

## Backtest (real games, ratings from earlier games only)
2,475 FBS games, 2024 – 2026 week 9, against CFBD's Elo forecast on the same games:

| Season | Winners picked: model / Elo | Log loss: model / Elo |
| --- | --- | --- |
| 2024 (settings tuned here) | 72.5% / 67.0% | 0.559 / 0.578 |
| 2025 | 75.3% / 72.2% | 0.528 / 0.547 |
| 2026 through week 9 | 75.1% / 72.6% | 0.569 / 0.564 |

Picks with 3 signals won 87% of FBS-vs-FBS games, 4 won 90%. Travel and weather weren't in the historical data, so those two signals are untested.

## Accuracy tab
- **Tracked picks** — with a database, each day's picks (every game, the best play, the parlays, sharp plays, the board and risks) are saved before the first kickoff (also by a daily 11:30 ET run) and graded against the finals; a finished day's grade is stored. A late lock only tracks games that hadn't started.
- **Replay test** — this season (or the last two) re-predicted week by week from earlier games only, with the live app's own pick code, graded. On 2025–2026: picks won 71.7% when the model said 70.8%; best play 25 of 27 full Saturdays; sharp plays 90.5%; 3/4/5-leg parlays 81% / 70% / 59%; flagged favorites 65% vs 72% predicted.

## Data
- Past results: [cfbfastR-data](https://github.com/sportsdataverse/cfbfastR-data) schedules (raw GitHub).
- This season's latest results, the day's slate, ranks, logos and live scores: ESPN's public scoreboard.
- Geocoding and weather: Open-Meteo.

## Deploy
Vercel, no build step. Optional: a Postgres `DATABASE_URL` (or `POSTGRES_URL`, etc.) to lock the best play and parlays at the first kickoff. `/api/health` checks every source.

`npm test` runs the tests against a synthetic world (no network).
