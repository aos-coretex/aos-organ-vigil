/**
 * Spine directed message handler for Vigil.
 *
 * Handles three message types:
 * - run_tests: Execute test run (scope from payload)
 * - test_trigger: Deterministic trigger for specific tests
 * - query_results: Return latest results for requested test IDs
 */

function log(event, data = {}) {
  const entry = { timestamp: new Date().toISOString(), event, ...data };
  process.stdout.write(JSON.stringify(entry) + '\n');
}

/**
 * Handle a directed OTM message.
 * @param {object} envelope - Spine message envelope { event_type, payload, from, id }
 * @param {{ run, runTest }} runner - test runner instance
 * @param {object} db - database handle
 * @returns {object|null} - response payload or null
 */
export async function handleDirectedMessage(envelope, runner, db) {
  const { event_type, payload } = envelope;

  switch (event_type) {
    case 'run_tests':
      return handleRunTests(payload, runner);

    case 'test_trigger':
      return handleTestTrigger(payload, runner);

    case 'query_results':
      return handleQueryResults(payload, db);

    default:
      log('unknown_message_type', { event_type });
      return null;
  }
}

/**
 * run_tests — execute a test run based on scope.
 * payload: { scope: 'all'|'group'|'tier'|'test', group?, tier?, test_id? }
 */
async function handleRunTests(payload, runner) {
  const { scope = 'all', group, tier, test_id } = payload || {};
  log('run_tests_received', { scope, group, tier, test_id });

  const results = await runner.run({
    scope,
    group,
    tier,
    test_id,
    triggered_by: 'manual',
  });

  return {
    event_type: 'run_tests_result',
    results,
    summary: {
      total: results.length,
      pass: results.filter((r) => r.status === 'pass').length,
      fail: results.filter((r) => r.status === 'fail').length,
      blocked: results.filter((r) => r.status === 'blocked').length,
    },
  };
}

/**
 * test_trigger — run specific tests by ID.
 * payload: { test_ids: string[] }
 */
async function handleTestTrigger(payload, runner) {
  const { test_ids = [] } = payload || {};
  log('test_trigger_received', { test_ids });

  const results = [];
  for (const id of test_ids) {
    const result = await runner.runTest(id, 'deterministic');
    results.push(result);
  }

  return {
    event_type: 'test_trigger_result',
    results,
  };
}

/**
 * query_results — return latest results for requested test IDs.
 * payload: { test_ids: string[] }
 */
function handleQueryResults(payload, db) {
  const { test_ids = [] } = payload || {};
  log('query_results_received', { test_ids });

  const results = [];
  for (const id of test_ids) {
    const urn = `urn:llm-ops:verification:latest:${id}`;
    const row = db.prepare('SELECT data FROM concepts WHERE urn = ?').get(urn);
    if (row) {
      results.push(JSON.parse(row.data));
    } else {
      results.push({ test_id: id, status: 'unknown', detail: 'No results found' });
    }
  }

  return {
    event_type: 'query_results_response',
    results,
  };
}
