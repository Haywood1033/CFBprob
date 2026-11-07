// api/_util.js — small helpers shared by the endpoints.
const param = (req, k) => (req.query && req.query[k] !== undefined ? String(req.query[k]) : new URL(req.url || '/', 'http://x').searchParams.get(k));
function send(res, code, body, cacheSeconds = 0) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheSeconds ? `s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}` : 'no-store');
  res.status(code).json(body);
}
const fail = (res, err) => send(res, 500, { error: err?.message || String(err) });
module.exports = { param, send, fail };
