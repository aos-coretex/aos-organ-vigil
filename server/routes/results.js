import { Router } from 'express';

export function createResultsRouter(db) {
  const router = Router();

  // POST /tests/:id/result — store a test result
  router.post('/:id/result', (req, res) => {
    const testId = req.params.id;
    const { status, detail, duration_ms, triggered_by, trigger_event } = req.body;

    if (!status || !['pass', 'fail', 'blocked'].includes(status)) {
      return res.status(400).json({ error: 'Invalid or missing status (pass|fail|blocked)', status: 400 });
    }
    if (detail === undefined || detail === null) {
      return res.status(400).json({ error: 'Missing required field: detail', status: 400 });
    }
    if (duration_ms === undefined || duration_ms === null) {
      return res.status(400).json({ error: 'Missing required field: duration_ms', status: 400 });
    }
    if (!triggered_by || !['manual', 'scheduled', 'deterministic'].includes(triggered_by)) {
      return res.status(400).json({ error: 'Invalid or missing triggered_by (manual|scheduled|deterministic)', status: 400 });
    }

    const now = new Date().toISOString();
    const latestUrn = `urn:llm-ops:verification:latest:${testId}`;
    const historicalUrn = `urn:llm-ops:verification:${testId}:${now}`;

    const data = JSON.stringify({
      type: 'verification_result',
      test_id: testId,
      status,
      detail,
      duration_ms,
      triggered_by,
      trigger_event: trigger_event || null,
      timestamp: now,
    });

    const upsertLatest = db.prepare(
      'INSERT OR REPLACE INTO concepts (urn, data, created_at) VALUES (?, ?, ?)'
    );
    const insertHistorical = db.prepare(
      'INSERT INTO concepts (urn, data, created_at) VALUES (?, ?, ?)'
    );

    const transaction = db.transaction(() => {
      upsertLatest.run(latestUrn, data, now);
      insertHistorical.run(historicalUrn, data, now);
    });
    transaction();

    res.status(201).json({ urn: historicalUrn, test_id: testId, status: 'created' });
  });

  // GET /tests/:id/result — get latest result for a test
  router.get('/:id/result', (req, res) => {
    const testId = req.params.id;
    const latestUrn = `urn:llm-ops:verification:latest:${testId}`;

    const row = db.prepare('SELECT data FROM concepts WHERE urn = ?').get(latestUrn);
    if (!row) {
      return res.status(404).json({ error: `No results found for test: ${testId}`, status: 404 });
    }

    const parsed = JSON.parse(row.data);
    res.json({
      test_id: parsed.test_id,
      status: parsed.status,
      detail: parsed.detail,
      duration_ms: parsed.duration_ms,
      triggered_by: parsed.triggered_by,
      trigger_event: parsed.trigger_event,
      timestamp: parsed.timestamp,
    });
  });

  // GET /tests/status — freshness dashboard
  router.get('/status', (req, res) => {
    const { group, tier } = req.query;

    const rows = db.prepare(
      "SELECT data FROM concepts WHERE urn LIKE 'urn:llm-ops:verification:latest:%'"
    ).all();

    let tests = rows.map((row) => JSON.parse(row.data));

    if (group) {
      tests = tests.filter((t) => t.group === group);
    }
    if (tier) {
      tests = tests.filter((t) => t.tier === tier);
    }

    const summary = { pass: 0, fail: 0, blocked: 0, running: 0, unknown: 0 };
    for (const t of tests) {
      if (summary[t.status] !== undefined) {
        summary[t.status]++;
      } else {
        summary.unknown++;
      }
    }

    res.json({
      tests,
      summary,
      generated_at: new Date().toISOString(),
    });
  });

  return router;
}
