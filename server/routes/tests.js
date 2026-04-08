import { Router } from 'express';

export function createTestsRouter(db) {
  const router = Router();

  // POST /tests/register — register a test definition
  router.post('/register', (req, res) => {
    const { id, name, tier, group, schedule, deterministic, timeout_ms, dependencies } = req.body;

    if (!id || !name || !tier || !group || !schedule) {
      return res.status(400).json({
        error: 'Missing required fields: id, name, tier, group, schedule',
        status: 400,
      });
    }
    if (!['unit', 'integration'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier (unit|integration)', status: 400 });
    }
    if (!['6h', 'daily', 'weekly'].includes(schedule)) {
      return res.status(400).json({ error: 'Invalid schedule (6h|daily|weekly)', status: 400 });
    }

    const now = new Date().toISOString();
    const urn = `urn:llm-ops:verification:test-def:${id}`;

    const data = JSON.stringify({
      type: 'test_definition',
      id,
      name,
      tier,
      group,
      schedule,
      deterministic: deterministic || [],
      timeout_ms: timeout_ms || 5000,
      dependencies: dependencies || [],
      registered_at: now,
    });

    db.prepare(
      'INSERT OR REPLACE INTO concepts (urn, data, created_at) VALUES (?, ?, ?)'
    ).run(urn, data, now);

    res.status(201).json({ id, registered: true, registered_at: now });
  });

  // GET /tests/registry — list all registered test definitions
  router.get('/registry', (_req, res) => {
    const rows = db.prepare(
      "SELECT data FROM concepts WHERE json_extract(data, '$.type') = 'test_definition'"
    ).all();

    const tests = rows.map((row) => JSON.parse(row.data));
    res.json({ tests, count: tests.length });
  });

  return router;
}
