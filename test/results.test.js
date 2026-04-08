import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { initDatabase } from '../server/db/init.js';
import { createResultsRouter } from '../server/routes/results.js';

describe('Results API', () => {
  let db;
  let app;
  let baseUrl;
  let server;

  before(async () => {
    db = initDatabase(':memory:');
    app = express();
    app.use(express.json());
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

  it('1. should store a test result (POST /tests/:id/result)', async () => {
    const res = await fetch(`${baseUrl}/tests/auth-session-token/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'pass',
        detail: 'Session token valid',
        duration_ms: 45,
        triggered_by: 'manual',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.test_id, 'auth-session-token');
    assert.equal(body.status, 'created');
    assert.ok(body.urn.startsWith('urn:llm-ops:verification:auth-session-token:'));
  });

  it('2. should create both latest and historical URNs', () => {
    const latest = db.prepare(
      "SELECT * FROM concepts WHERE urn = 'urn:llm-ops:verification:latest:auth-session-token'"
    ).get();
    assert.ok(latest, 'latest concept should exist');

    const historical = db.prepare(
      "SELECT * FROM concepts WHERE urn LIKE 'urn:llm-ops:verification:auth-session-token:%'"
    ).all();
    assert.ok(historical.length >= 1, 'at least one historical concept should exist');
  });

  it('3. should upsert latest while preserving historical on second result', async () => {
    const res = await fetch(`${baseUrl}/tests/auth-session-token/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'fail',
        detail: 'Token expired',
        duration_ms: 12,
        triggered_by: 'scheduled',
      }),
    });
    assert.equal(res.status, 201);

    // Latest should be updated to fail
    const latest = db.prepare(
      "SELECT data FROM concepts WHERE urn = 'urn:llm-ops:verification:latest:auth-session-token'"
    ).get();
    const parsed = JSON.parse(latest.data);
    assert.equal(parsed.status, 'fail');

    // Historical should now have 2 entries
    const historical = db.prepare(
      "SELECT * FROM concepts WHERE urn LIKE 'urn:llm-ops:verification:auth-session-token:%'"
    ).all();
    assert.equal(historical.length, 2);
  });

  it('4. should retrieve latest result (GET /tests/:id/result)', async () => {
    const res = await fetch(`${baseUrl}/tests/auth-session-token/result`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.test_id, 'auth-session-token');
    assert.equal(body.status, 'fail');
    assert.equal(body.detail, 'Token expired');
    assert.equal(body.duration_ms, 12);
    assert.equal(body.triggered_by, 'scheduled');
  });

  it('5. should return 404 for non-existent test result', async () => {
    const res = await fetch(`${baseUrl}/tests/nonexistent-test/result`);
    assert.equal(res.status, 404);
  });

  it('6. should return freshness dashboard (GET /tests/status)', async () => {
    const res = await fetch(`${baseUrl}/tests/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.tests));
    assert.ok(body.summary);
    assert.ok(body.generated_at);
    assert.equal(body.summary.fail, 1);
  });

  it('7. should validate required fields', async () => {
    const res = await fetch(`${baseUrl}/tests/bad-test/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pass' }),
    });
    assert.equal(res.status, 400);
  });

  it('8. should reject invalid status value', async () => {
    const res = await fetch(`${baseUrl}/tests/bad-test/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'invalid',
        detail: 'x',
        duration_ms: 1,
        triggered_by: 'manual',
      }),
    });
    assert.equal(res.status, 400);
  });

  it('9. should reject invalid triggered_by value', async () => {
    const res = await fetch(`${baseUrl}/tests/bad-test/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'pass',
        detail: 'x',
        duration_ms: 1,
        triggered_by: 'unknown',
      }),
    });
    assert.equal(res.status, 400);
  });

  it('10. should store trigger_event when provided', async () => {
    const res = await fetch(`${baseUrl}/tests/triggered-test/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'pass',
        detail: 'OK',
        duration_ms: 5,
        triggered_by: 'deterministic',
        trigger_event: 'urn:llm-ops:event:2026-04-07-dream_done-a1b2',
      }),
    });
    assert.equal(res.status, 201);

    const getRes = await fetch(`${baseUrl}/tests/triggered-test/result`);
    const body = await getRes.json();
    assert.equal(body.trigger_event, 'urn:llm-ops:event:2026-04-07-dream_done-a1b2');
  });

  it('11. should include verification_result type in stored data', () => {
    const row = db.prepare(
      "SELECT data FROM concepts WHERE urn = 'urn:llm-ops:verification:latest:auth-session-token'"
    ).get();
    const parsed = JSON.parse(row.data);
    assert.equal(parsed.type, 'verification_result');
  });
});
