// GET /api/accuracy — the tracked record (each day's locked picks, graded after the games).
// GET /api/accuracy?replay=1[&seasons=current|two] — the Replay test on past weeks.
const { gradeAll, summarize } = require('../lib/grading');
const { runBacktest } = require('../lib/backtest');
const { etDate, seasonOf } = require('../lib/slate');
const db = require('../lib/db');
const { param, send, fail } = require('./_util');

module.exports = async (req, res) => {
  try {
    const season = seasonOf(etDate());
    if (param(req, 'replay')) {
      const seasons = param(req, 'seasons') === 'current' ? [season] : [season - 1, season];
      return send(res, 200, await runBacktest({ seasons, currentSeason: season }), 600);
    }
    if (!db.hasDb) return send(res, 200, { connected: false, note: 'Pick tracking needs the database.' });
    const days = await gradeAll();
    send(res, 200, { connected: true, summary: summarize(days), days: days.slice(0, 30).map(d => ({ date: d.date, complete: d.complete, best: d.best, parlays: d.parlays, games: d.games.filter(g => g.fbs).length, record: (() => { const x = d.games.filter(g => g.fbs && g.won !== null); return { won: x.filter(g => g.won).length, n: x.length }; })(), sharp: d.sharp })) });
  } catch (err) { fail(res, err); }
};
