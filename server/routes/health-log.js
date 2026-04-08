import { Router } from 'express';

export function createHealthLogRouter(db) {
  const router = Router();

  // POST /health-log — append a health log entry
  router.post('/', (req, res) => {
    const { status, failing_tests, graphheight_reachable } = req.body;

    if (!status || !['healthy', 'degraded', 'critical'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid or missing status (healthy|degraded|critical)',
        status: 400,
      });
    }

    const failingTestsJson = failing_tests ? JSON.stringify(failing_tests) : null;
    const reachable = graphheight_reachable === undefined ? 1 : (graphheight_reachable ? 1 : 0);

    const result = db.prepare(
      'INSERT INTO health_log (status, failing_tests, graphheight_reachable) VALUES (?, ?, ?)'
    ).run(status, failingTestsJson, reachable);

    const row = db.prepare('SELECT timestamp FROM health_log WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json({
      id: Number(result.lastInsertRowid),
      status,
      timestamp: row.timestamp,
    });
  });

  // GET /health-log — query health log
  router.get('/', (req, res) => {
    const { since, limit } = req.query;
    const effectiveLimit = limit ? parseInt(limit, 10) : 100;

    let rows;
    if (since) {
      rows = db.prepare(
        'SELECT * FROM health_log WHERE timestamp > ? ORDER BY id DESC LIMIT ?'
      ).all(since, effectiveLimit);
    } else {
      rows = db.prepare(
        'SELECT * FROM health_log ORDER BY id DESC LIMIT ?'
      ).all(effectiveLimit);
    }

    const entries = rows.map((row) => ({
      id: row.id,
      status: row.status,
      failing_tests: row.failing_tests ? JSON.parse(row.failing_tests) : null,
      graphheight_reachable: row.graphheight_reachable === 1,
      timestamp: row.timestamp,
    }));

    res.json({ entries, count: entries.length });
  });

  // GET /health-log/current — most recent health log entry
  router.get('/current', (_req, res) => {
    const row = db.prepare(
      'SELECT * FROM health_log ORDER BY id DESC LIMIT 1'
    ).get();

    if (!row) {
      return res.status(404).json({ error: 'No health log entries exist', status: 404 });
    }

    res.json({
      status: row.status,
      failing_tests: row.failing_tests ? JSON.parse(row.failing_tests) : [],
      last_check: row.timestamp,
      graphheight_reachable: row.graphheight_reachable === 1,
    });
  });

  return router;
}
