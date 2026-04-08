import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { initDatabase } from '../server/db/init.js';
import { createTestsRouter } from '../server/routes/tests.js';

describe('Test Registration API', () => {
  let db;
  let app;
  let baseUrl;
  let server;

  before(async () => {
    db = initDatabase(':memory:');
    app = express();
    app.use(express.json());
    app.use('/tests', createTestsRouter(db));

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

  it('1. should register a new test definition', async () => {
    const res = await fetch(`${baseUrl}/tests/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'auth-session-token',
        name: 'Session token validity',
        tier: 'unit',
        group: 'auth',
        schedule: '6h',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.id, 'auth-session-token');
    assert.equal(body.registered, true);
    assert.ok(body.registered_at);
  });

  it('2. should store test definition as concept with correct URN', () => {
    const row = db.prepare(
      "SELECT * FROM concepts WHERE urn = 'urn:llm-ops:verification:test-def:auth-session-token'"
    ).get();
    assert.ok(row);
    const parsed = JSON.parse(row.data);
    assert.equal(parsed.type, 'test_definition');
    assert.equal(parsed.id, 'auth-session-token');
    assert.equal(parsed.tier, 'unit');
    assert.equal(parsed.group, 'auth');
    assert.equal(parsed.schedule, '6h');
  });

  it('3. should re-register (update) existing test definition', async () => {
    const res = await fetch(`${baseUrl}/tests/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'auth-session-token',
        name: 'Session token validity (updated)',
        tier: 'unit',
        group: 'auth',
        schedule: 'daily',
      }),
    });
    assert.equal(res.status, 201);

    const row = db.prepare(
      "SELECT data FROM concepts WHERE urn = 'urn:llm-ops:verification:test-def:auth-session-token'"
    ).get();
    const parsed = JSON.parse(row.data);
    assert.equal(parsed.name, 'Session token validity (updated)');
    assert.equal(parsed.schedule, 'daily');
  });

  it('4. should list all registered test definitions', async () => {
    // Register a second test
    await fetch(`${baseUrl}/tests/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'db-connectivity',
        name: 'Database connectivity',
        tier: 'integration',
        group: 'infrastructure',
        schedule: '6h',
        dependencies: ['auth-session-token'],
      }),
    });

    const res = await fetch(`${baseUrl}/tests/registry`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.count, 2);
    assert.equal(body.tests.length, 2);
  });

  it('5. should reject missing required fields', async () => {
    const res = await fetch(`${baseUrl}/tests/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'incomplete-test' }),
    });
    assert.equal(res.status, 400);
  });

  it('6. should reject invalid tier', async () => {
    const res = await fetch(`${baseUrl}/tests/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'bad-tier',
        name: 'Bad tier',
        tier: 'invalid',
        group: 'test',
        schedule: '6h',
      }),
    });
    assert.equal(res.status, 400);
  });

  it('7. should reject invalid schedule', async () => {
    const res = await fetch(`${baseUrl}/tests/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'bad-schedule',
        name: 'Bad schedule',
        tier: 'unit',
        group: 'test',
        schedule: 'hourly',
      }),
    });
    assert.equal(res.status, 400);
  });

  it('8. should preserve optional fields (deterministic, timeout_ms, dependencies)', async () => {
    await fetch(`${baseUrl}/tests/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'with-optionals',
        name: 'Test with optionals',
        tier: 'integration',
        group: 'spine',
        schedule: 'daily',
        deterministic: [{ event: 'dream_radiant_done' }],
        timeout_ms: 10000,
        dependencies: ['auth-session-token'],
      }),
    });

    const row = db.prepare(
      "SELECT data FROM concepts WHERE urn = 'urn:llm-ops:verification:test-def:with-optionals'"
    ).get();
    const parsed = JSON.parse(row.data);
    assert.deepEqual(parsed.deterministic, [{ event: 'dream_radiant_done' }]);
    assert.equal(parsed.timeout_ms, 10000);
    assert.deepEqual(parsed.dependencies, ['auth-session-token']);
  });

  it('9. should set defaults for omitted optional fields', () => {
    const row = db.prepare(
      "SELECT data FROM concepts WHERE urn = 'urn:llm-ops:verification:test-def:auth-session-token'"
    ).get();
    const parsed = JSON.parse(row.data);
    assert.deepEqual(parsed.deterministic, []);
    assert.equal(parsed.timeout_ms, 5000);
    assert.deepEqual(parsed.dependencies, []);
  });
});
