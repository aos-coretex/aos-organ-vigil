/**
 * Tests for the Vigil test execution engine:
 * - Registry parser
 * - Test runner (execution, persistence, timeout)
 * - Trigger filters
 * - Message handlers
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDatabase } from '../server/db/init.js';
import { loadRegistry, indexById, filterRegistry, extractTriggerEvents, getTestsForEvent } from '../server/engine/registry.js';
import { createRunner } from '../server/engine/runner.js';
import { buildTriggerFilters, handleTriggerEvent } from '../server/triggers/filters.js';
import { handleDirectedMessage } from '../server/handlers/messages.js';

// Create a minimal test registry YAML file for testing
const MOCK_REGISTRY_YAML = `
- id: test-alpha
  name: Alpha test
  tier: unit
  group: databases
  schedule: 6h
  deterministic:
    - event: dream_radiant_done
  timeout_ms: 3000
  dependencies: []

- id: test-beta
  name: Beta test
  tier: unit
  group: radiant
  schedule: daily
  deterministic:
    - event: dream_radiant_done
    - event: session_start
  timeout_ms: 5000
  dependencies: []

- id: test-gamma
  name: Gamma test
  tier: integration
  group: capture
  schedule: weekly
  deterministic: []
  timeout_ms: 10000
  dependencies:
    - test-alpha
`;

let tmpYamlPath;

describe('Registry Parser', () => {
  before(() => {
    const dir = join(tmpdir(), 'vigil-test-' + Date.now());
    mkdirSync(dir, { recursive: true });
    tmpYamlPath = join(dir, 'test-registry.yaml');
    writeFileSync(tmpYamlPath, MOCK_REGISTRY_YAML);
  });

  after(() => {
    try { unlinkSync(tmpYamlPath); } catch {}
  });

  it('1. should parse YAML registry into array', () => {
    const registry = loadRegistry(tmpYamlPath);
    assert.ok(Array.isArray(registry));
    assert.equal(registry.length, 3);
  });

  it('2. should preserve test fields', () => {
    const registry = loadRegistry(tmpYamlPath);
    const alpha = registry.find((t) => t.id === 'test-alpha');
    assert.equal(alpha.name, 'Alpha test');
    assert.equal(alpha.tier, 'unit');
    assert.equal(alpha.group, 'databases');
    assert.equal(alpha.schedule, '6h');
    assert.equal(alpha.timeout_ms, 3000);
  });

  it('3. should parse deterministic triggers', () => {
    const registry = loadRegistry(tmpYamlPath);
    const beta = registry.find((t) => t.id === 'test-beta');
    assert.equal(beta.deterministic.length, 2);
    assert.equal(beta.deterministic[0].event, 'dream_radiant_done');
    assert.equal(beta.deterministic[1].event, 'session_start');
  });

  it('4. should build index by ID', () => {
    const registry = loadRegistry(tmpYamlPath);
    const index = indexById(registry);
    assert.ok(index.has('test-alpha'));
    assert.ok(index.has('test-beta'));
    assert.ok(index.has('test-gamma'));
    assert.equal(index.get('test-alpha').group, 'databases');
  });

  it('5. should filter by group', () => {
    const registry = loadRegistry(tmpYamlPath);
    const filtered = filterRegistry(registry, { group: 'databases' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'test-alpha');
  });

  it('6. should filter by tier', () => {
    const registry = loadRegistry(tmpYamlPath);
    const filtered = filterRegistry(registry, { tier: 'integration' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'test-gamma');
  });

  it('7. should extract unique trigger events', () => {
    const registry = loadRegistry(tmpYamlPath);
    const events = extractTriggerEvents(registry);
    assert.ok(events.includes('dream_radiant_done'));
    assert.ok(events.includes('session_start'));
    assert.equal(events.length, 2);
  });

  it('8. should get tests for a specific trigger event', () => {
    const registry = loadRegistry(tmpYamlPath);
    const tests = getTestsForEvent(registry, 'dream_radiant_done');
    assert.equal(tests.length, 2);
    const ids = tests.map((t) => t.id);
    assert.ok(ids.includes('test-alpha'));
    assert.ok(ids.includes('test-beta'));
  });
});

describe('Test Runner', () => {
  let db;

  before(() => {
    db = initDatabase(':memory:');
  });

  after(() => {
    db.close();
  });

  it('9. should persist test result (latest + historical)', async () => {
    // Minimal registry with a test that has no function (will be "blocked")
    const registry = [{ id: 'fake-test', tier: 'unit', group: 'test', schedule: '6h' }];
    const runner = createRunner(db, registry);

    const result = await runner.runTest('fake-test', 'manual');
    assert.equal(result.status, 'blocked');
    assert.ok(result.detail.includes('No test function'));

    // Check persistence
    const latest = db.prepare(
      "SELECT data FROM concepts WHERE urn = 'urn:llm-ops:verification:latest:fake-test'"
    ).get();
    assert.ok(latest, 'latest result should be persisted');
    const parsed = JSON.parse(latest.data);
    assert.equal(parsed.status, 'blocked');
    assert.equal(parsed.triggered_by, 'manual');
  });

  it('10. should run scoped subset of tests', async () => {
    const registry = [
      { id: 'fake-a', tier: 'unit', group: 'g1', schedule: '6h' },
      { id: 'fake-b', tier: 'unit', group: 'g2', schedule: '6h' },
    ];
    const runner = createRunner(db, registry);
    const results = await runner.run({ scope: 'group', group: 'g1', triggered_by: 'scheduled' });
    // No test functions exist, so all should be blocked, but only g1 tests should run
    assert.equal(results.length, 0); // no implementations, so filtered out
  });
});

describe('Trigger Filters', () => {
  it('11. should build subscription filters from registry', () => {
    const registry = [
      { id: 'a', deterministic: [{ event: 'evt1' }] },
      { id: 'b', deterministic: [{ event: 'evt1' }, { event: 'evt2' }] },
      { id: 'c', deterministic: [] },
    ];
    const filters = buildTriggerFilters(registry);
    assert.equal(filters.length, 2);
    const types = filters.map((f) => f.event_type);
    assert.ok(types.includes('evt1'));
    assert.ok(types.includes('evt2'));
  });
});

describe('Directed Message Handlers', () => {
  let db;

  before(() => {
    db = initDatabase(':memory:');
  });

  after(() => {
    db.close();
  });

  it('12. should handle query_results for stored test', async () => {
    // Insert a test result
    const data = JSON.stringify({
      type: 'verification_result',
      test_id: 'msg-test-1',
      status: 'pass',
      detail: 'OK',
      duration_ms: 5,
      triggered_by: 'manual',
      timestamp: new Date().toISOString(),
    });
    db.prepare('INSERT INTO concepts (urn, data, created_at) VALUES (?, ?, ?)').run(
      'urn:llm-ops:verification:latest:msg-test-1', data, new Date().toISOString()
    );

    const registry = [];
    const runner = createRunner(db, registry);
    const response = await handleDirectedMessage(
      { event_type: 'query_results', payload: { test_ids: ['msg-test-1', 'nonexistent'] } },
      runner, db
    );

    assert.equal(response.event_type, 'query_results_response');
    assert.equal(response.results.length, 2);
    assert.equal(response.results[0].status, 'pass');
    assert.equal(response.results[1].status, 'unknown');
  });

  it('13. should handle run_tests with scope=test', async () => {
    const registry = [{ id: 'msg-test-2', tier: 'unit', group: 'test', schedule: '6h' }];
    const runner = createRunner(db, registry);

    const response = await handleDirectedMessage(
      { event_type: 'run_tests', payload: { scope: 'test', test_id: 'msg-test-2' } },
      runner, db
    );

    assert.equal(response.event_type, 'run_tests_result');
    assert.ok(response.summary);
    assert.equal(response.summary.total, 0); // no implementation, filtered out
  });

  it('14. should return null for unknown message type', async () => {
    const response = await handleDirectedMessage(
      { event_type: 'unknown_type', payload: {} },
      null, db
    );
    assert.equal(response, null);
  });

  it('15. should handle test_trigger message', async () => {
    const registry = [];
    const runner = createRunner(db, registry);

    const response = await handleDirectedMessage(
      { event_type: 'test_trigger', payload: { test_ids: ['nonexistent-test'] } },
      runner, db
    );

    assert.equal(response.event_type, 'test_trigger_result');
    assert.equal(response.results.length, 1);
    assert.equal(response.results[0].status, 'blocked');
  });
});
