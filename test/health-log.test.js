import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { initDatabase } from '../server/db/init.js';
import { createHealthLogRouter } from '../server/routes/health-log.js';

describe('Health Log API', () => {
  let db;
  let app;
  let baseUrl;
  let server;

  before(async () => {
    db = initDatabase(':memory:');
    app = express();
    app.use(express.json());
    app.use('/health-log', createHealthLogRouter(db));

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });

  it('1. should return 404 for /health-log/current when no entries exist', async () => {
    const res = await fetch(`${baseUrl}/health-log/current`);
    assert.equal(res.status, 404);
  });

  it('2. should append a health log entry', async () => {
    const res = await fetch(`${baseUrl}/health-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'healthy',
        failing_tests: [],
        graphheight_reachable: true,
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.status, 'healthy');
    assert.ok(body.id);
    assert.ok(body.timestamp);
  });

  it('3. should append a degraded entry with failing tests', async () => {
    const res = await fetch(`${baseUrl}/health-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'degraded',
        failing_tests: ['auth-session-token', 'db-connectivity'],
        graphheight_reachable: false,
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.status, 'degraded');
  });

  it('4. should get current (most recent) health log entry', async () => {
    const res = await fetch(`${baseUrl}/health-log/current`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'degraded');
    assert.deepEqual(body.failing_tests, ['auth-session-token', 'db-connectivity']);
    assert.equal(body.graphheight_reachable, false);
    assert.ok(body.last_check);
  });

  it('5. should query health log with default limit', async () => {
    const res = await fetch(`${baseUrl}/health-log`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.count, 2);
    assert.equal(body.entries.length, 2);
    // Descending order — most recent first
    assert.equal(body.entries[0].status, 'degraded');
    assert.equal(body.entries[1].status, 'healthy');
  });

  it('6. should query health log with limit', async () => {
    const res = await fetch(`${baseUrl}/health-log?limit=1`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.count, 1);
    assert.equal(body.entries[0].status, 'degraded');
  });

  it('7. should query health log with since filter', async () => {
    // Add a critical entry
    await fetch(`${baseUrl}/health-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'critical' }),
    });

    // Query with a since timestamp before the critical entry
    // Use a timestamp in the past that captures all entries
    const res = await fetch(`${baseUrl}/health-log?since=2020-01-01T00:00:00`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.count, 3);
  });

  it('8. should reject invalid status', async () => {
    const res = await fetch(`${baseUrl}/health-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'unknown' }),
    });
    assert.equal(res.status, 400);
  });

  it('9. should handle missing optional fields gracefully', async () => {
    const res = await fetch(`${baseUrl}/health-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'healthy' }),
    });
    assert.equal(res.status, 201);

    const getRes = await fetch(`${baseUrl}/health-log/current`);
    const body = await getRes.json();
    assert.equal(body.status, 'healthy');
    assert.equal(body.graphheight_reachable, true); // default
  });

  it('10. should parse failing_tests as JSON array in responses', async () => {
    await fetch(`${baseUrl}/health-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'degraded',
        failing_tests: ['test-a', 'test-b', 'test-c'],
      }),
    });

    const res = await fetch(`${baseUrl}/health-log/current`);
    const body = await res.json();
    assert.ok(Array.isArray(body.failing_tests));
    assert.equal(body.failing_tests.length, 3);
  });
});
