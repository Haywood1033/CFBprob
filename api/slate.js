// GET /api/slate?date=YYYY-MM-DD — the day's games (no date = today, US Eastern) with the model's
// projection, pick, signals and conditions, plus the best play and the 3-, 4- and 5-leg parlays.
const { getSlate } = require('../lib/slate');
const { param, send, fail } = require('./_util');

module.exports = async (req, res) => {
  try {
    const date = param(req, 'date');
    if (date && !/^\d{4}-\d\d-\d\d$/.test(date)) return send(res, 400, { error: 'date must be YYYY-MM-DD' });
    const s = await getSlate(date ? { date } : {});
    send(res, 200, s, s.games.some(g => g.state === 'in') ? 0 : 120);
  } catch (err) { fail(res, err); }
};
