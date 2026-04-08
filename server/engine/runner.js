/**
 * Test execution engine — runs test functions, captures results, persists to Vigil DB.
 *
 * Each test is an async function returning { status: 'pass'|'fail', detail: string }.
 * The runner manages: function lookup, execution timing, result persistence (latest + historical).
 */

import { testFunctions } from './tests/unit/index.js';
import { indexById } from './registry.js';

function log(event, data = {}) {
  const entry = { timestamp: new Date().toISOString(), event, ...data };
  process.stdout.write(JSON.stringify(entry) + '\n');
}

/**
 * Create a runner instance bound to a Vigil database and registry.
 * @param {object} db - better-sqlite3 database handle
 * @param {Array<object>} registry - parsed CV registry
 * @returns {{ run, runTest }}
 */
export function createRunner(db, registry) {
  const registryIndex = indexById(registry);

  const upsertLatest = db.prepare(
    'INSERT OR REPLACE INTO concepts (urn, data, created_at) VALUES (?, ?, ?)'
  );
  const insertHistorical = db.prepare(
    'INSERT INTO concepts (urn, data, created_at) VALUES (?, ?, ?)'
  );
  const persistTransaction = db.transaction((latestUrn, historicalUrn, data, now) => {
    upsertLatest.run(latestUrn, data, now);
    insertHistorical.run(historicalUrn, data, now);
  });

  /**
   * Run a single test by ID.
   * @param {string} testId
   * @param {string} triggeredBy - 'manual' | 'scheduled' | 'deterministic'
   * @param {string} [triggerEvent] - optional trigger event URN
   * @returns {Promise<object>} - { test_id, status, detail, duration_ms }
   */
  async function runTest(testId, triggeredBy = 'manual', triggerEvent = null) {
    // Convert test id to function name: dashes → underscores
    const fnName = `test_${testId.replace(/-/g, '_')}`;
    const fn = testFunctions[fnName];

    if (!fn) {
      const result = { test_id: testId, status: 'blocked', detail: `No test function: ${fnName}`, duration_ms: 0 };
      persistResult(testId, result, triggeredBy, triggerEvent);
      return result;
    }

    const testDef = registryIndex.get(testId);
    const timeoutMs = testDef?.timeout_ms || 5000;

    const start = Date.now();
    let status, detail;

    try {
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TEST_TIMEOUT')), timeoutMs)
        ),
      ]);
      status = result.status;
      detail = result.detail;
    } catch (err) {
      status = 'fail';
      detail = err.message === 'TEST_TIMEOUT'
        ? `Timed out after ${timeoutMs}ms`
        : `Exception: ${err.message}`;
    }

    const durationMs = Date.now() - start;
    const result = { test_id: testId, status, detail, duration_ms: durationMs };
    persistResult(testId, result, triggeredBy, triggerEvent);

    log('test_executed', { test_id: testId, status, duration_ms: durationMs });
    return result;
  }

  /**
   * Run multiple tests based on scope.
   * @param {object} opts - { scope, group?, tier?, test_id?, triggered_by }
   * @returns {Promise<Array<object>>}
   */
  async function run({ scope = 'all', group, tier, test_id, triggered_by = 'manual', trigger_event } = {}) {
    let testIds = [];

    if (scope === 'test' && test_id) {
      testIds = [test_id];
    } else if (scope === 'group' && group) {
      testIds = registry.filter((t) => t.group === group).map((t) => t.id);
    } else if (scope === 'tier' && tier) {
      testIds = registry.filter((t) => t.tier === tier).map((t) => t.id);
    } else {
      // 'all' — but only tests we have functions for
      testIds = registry.map((t) => t.id);
    }

    // Filter to tests we actually have implementations for
    const implementedIds = testIds.filter((id) => {
      const fnName = `test_${id.replace(/-/g, '_')}`;
      return testFunctions[fnName] !== undefined;
    });

    const results = [];
    for (const id of implementedIds) {
      const result = await runTest(id, triggered_by, trigger_event);
      results.push(result);
    }

    log('run_complete', {
      scope,
      triggered_by,
      total: implementedIds.length,
      pass: results.filter((r) => r.status === 'pass').length,
      fail: results.filter((r) => r.status === 'fail').length,
      blocked: results.filter((r) => r.status === 'blocked').length,
    });

    return results;
  }

  function persistResult(testId, result, triggeredBy, triggerEvent) {
    const now = new Date().toISOString();
    const latestUrn = `urn:llm-ops:verification:latest:${testId}`;
    const historicalUrn = `urn:llm-ops:verification:${testId}:${now}`;

    const data = JSON.stringify({
      type: 'verification_result',
      test_id: testId,
      status: result.status,
      detail: result.detail,
      duration_ms: result.duration_ms,
      triggered_by: triggeredBy,
      trigger_event: triggerEvent || null,
      timestamp: now,
    });

    try {
      persistTransaction(latestUrn, historicalUrn, data, now);
    } catch (err) {
      log('persist_error', { test_id: testId, error: err.message });
    }
  }

  return { run, runTest };
}
