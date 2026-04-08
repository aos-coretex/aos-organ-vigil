import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { initDatabase } from '../server/db/init.js';
import { createHealthRouter } from '../server/routes/health.js';
import { createTestsRouter } from '../server/routes/tests.js';
import { createResultsRouter } from '../server/routes/results.js';

describe('Health and Introspection API', () => {
  let db;
  let app;
  let baseUrl;
  let server;
  const startTime = Date.now();

  before(async () => {
    db = initDatabase(':memory:');
    app = express();
    app.use(express.json());
    app.use('/', createHealthRouter(db, startTime));
    app.use('/tests', createTestsRouter(db));
    app.use('/tests', createResultsRouter(db));

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

  it('1. should return ok health status when DB is accessible', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.db_connected, true);
    assert.equal(typeof body.uptime_s, 'number');
    assert.ok(body.uptime_s >= 0);
    assert.equal(body.tests_registered, 0);
  });

  it('2. should compute uptime correctly', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();
    const expectedUptime = Math.floor((Date.now() - startTime) / 1000);
    // Allow 1 second tolerance
    assert.ok(Math.abs(body.uptime_s - expectedUptime) <= 1);
  });

  it('3. should report tests_registered count', async () => {
    // Register a test definition
    await fetch(`${baseUrl}/tests/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'health-test-1',
        name: 'Health test 1',
        tier: 'unit',
        group: 'test',
        schedule: '6h',
      }),
    });

    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();
    assert.equal(body.tests_registered, 1);
  });

  it('4. should return introspection metrics', async () => {
    const res = await fetch(`${baseUrl}/introspect`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.tests_registered, 1);
    assert.equal(body.total_results, 0);
    assert.equal(body.health_log_entries, 0);
    assert.equal(body.last_result_ts, null);
    assert.equal(body.schema_version, '1.0.0');
    assert.equal(typeof body.db_path, 'string');
  });

  it('5. should update introspection after storing a result', async () => {
    await fetch(`${baseUrl}/tests/health-test-1/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'pass',
        detail: 'OK',
        duration_ms: 10,
        triggered_by: 'manual',
      }),
    });

    const res = await fetch(`${baseUrl}/introspect`);
    const body = await res.json();
    // 2 concepts: latest + historical
    assert.equal(body.total_results, 2);
    assert.ok(body.last_result_ts);
  });

  it('6. should report correct schema_version', async () => {
    const res = await fetch(`${baseUrl}/introspect`);
    const body = await res.json();
    assert.equal(body.schema_version, '1.0.0');
  });
});
