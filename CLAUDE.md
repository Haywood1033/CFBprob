# cfbprob

College football: the model's pick in every game, the best play of the day, a Best plays tab (sharp plays, All-Star board, Risks & fades), 3/4/5-leg parlays and an Accuracy tab.

One of the owner's seven sibling apps (cfbprob, golfprob, hrprob, nascarprob, nflprob, nhlprob,
ufcprob), each its own repo and Vercel project, sharing the same stack and design kit.

## Layout

- `lib/history.js`, `lib/csv.js`: past seasons from cfbfastR-data (raw GitHub CSVs).
- `lib/espn.js`: the day's slate, ranks, live scores, and the betting line (read only for the
  "market disagrees" flag).
- `lib/ratings.js`: ridge offense/defense ratings from scores (cap 31, lambda 2, 70% carry-over,
  365-day half-life, home field pulled toward 3 points with 300 games' weight).
- `lib/conditions.js`: rest, travel (Open-Meteo geocoding) and kickoff weather.
- `lib/picks.js`: pick, 8 signals, tags (Elite 6+, All-Star 5, Value 4), sharp rule, risk flags.
- `lib/slate.js`, `lib/lock.js`: the day's payload and the write-once lock (`cfb_daily_picks`).
- `lib/grading.js`, `lib/backtest.js`: Accuracy tab record and the replay.
- Cron: `/api/slate` daily at 15:30 UTC (saves the draft before kickoff).

## Rules specific to this app

- **No betting lines as inputs.** Picks come from matchups, home field, rest, travel and
  weather only. ESPN lines are read solely to flag "market disagrees"; they never move a pick.

## Open items

- Offered, not yet decided: make parlays sharp-only.
- To run on the live site: the replay "Last two seasons" market-flag table (does the flag
  predict misses?).

## How to work in this repo

- **Commands:** `npm test` runs the test suite (synthetic data, no network). After editing
  `app.html`, extract its `<script>` block and run `node --check` on it.
- **Deploy:** Vercel deploys `main` automatically; there's no build step. Pushing straight to `main`
  is fine for this project. A hard refresh (Cmd+Shift+R) may be needed after a deploy.
- **Secrets:** the database URL and any keys live in Vercel's environment variables. Refer to
  variable names only; never put values in code, commits or messages.
- **Stack:** Vercel serverless functions in `api/` (one file per route, `_util.js` shared), model
  and data code in `lib/`, the whole frontend in one `app.html` (vanilla JS, no framework), optional
  Postgres via `lib/db.js` (`DATABASE_URL`, `POSTGRES_URL` or the Prisma/Supabase variants).

## House rules (the owner's preferences)

- **Data first, honestly reported.** Model changes are checked on real past games (a leak-free
  replay: each day predicted only from earlier days) before they're called improvements, and
  results are reported as measured, including when a change doesn't help.
- **Public pages speak plainly.** No internal jargon, debug chips or "how we built it" notes on the
  page: that knowledge stays in the code and docs.
- **Picks lock.** Anything shown as the day's pick is saved write-once before the first start and
  never changes after; a database that doesn't answer writes nothing and shows "unconfirmed".
- **Never** put an AI model name in commits or code.
