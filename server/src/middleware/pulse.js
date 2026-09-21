const { emitAdmin } = require('../realtime/socket');

/**
 * LIVE PULSE — records every API hit and streams it to admins over WebSocket.
 * In-memory ring buffer (last 300 hits) + per-route aggregates + per-minute counters.
 * The pulse endpoints themselves are excluded to avoid feedback loops.
 */
const MAX_HITS = 300;
const hits = []; // newest-first
const perRoute = new Map(); // "GET /api/blocks/:n" -> { route, count, errors, totalMs }
const rpmBuckets = new Map(); // "YYYY-MM-DDTHH:MM" -> count

function routeKey(method, path) {
  const p = String(path)
    .replace(/0x[0-9a-fA-F]+/g, ':hash')
    .replace(/\b[0-9a-f]{24}\b/g, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n');
  return `${method} ${p}`;
}

function pulse(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    try {
      if (!req.path || !req.path.startsWith('/api')) return;
      if (req.path.startsWith('/api/admin/pulse')) return; // no feedback loop
      if (req.path === '/api/health') return; // too noisy, skip health probes

      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const hit = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        time: new Date().toISOString(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Number(ms.toFixed(1)),
        user: req.user ? req.user.email : null,
        role: req.user ? req.user.role : null,
        ip: req.ip || null,
      };

      hits.unshift(hit);
      if (hits.length > MAX_HITS) hits.pop();

      const k = routeKey(req.method, req.path);
      const agg = perRoute.get(k) || { route: k, count: 0, errors: 0, totalMs: 0 };
      agg.count += 1;
      agg.totalMs += ms;
      if (res.statusCode >= 400) agg.errors += 1;
      perRoute.set(k, agg);

      const minute = new Date().toISOString().slice(0, 16);
      rpmBuckets.set(minute, (rpmBuckets.get(minute) || 0) + 1);
      if (rpmBuckets.size > 120) {
        const keys = [...rpmBuckets.keys()].sort();
        while (rpmBuckets.size > 120) rpmBuckets.delete(keys.shift());
      }

      emitAdmin('pulse:hit', hit);
    } catch (_) {
      /* pulse must never break a request */
    }
  });
  next();
}

function pulseSummary() {
  const routes = [...perRoute.values()]
    .map((r) => ({
      route: r.route,
      count: r.count,
      errors: r.errors,
      avgMs: Number((r.totalMs / r.count).toFixed(1)),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);
  const rpm = [...rpmBuckets.entries()]
    .sort()
    .slice(-30)
    .map(([time, count]) => ({ time: time.slice(11), count }));
  return { hits: hits.slice(0, 100), routes, rpm, buffered: hits.length };
}

module.exports = { pulse, pulseSummary };
