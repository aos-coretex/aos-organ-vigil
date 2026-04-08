import { resolve } from 'node:path';
import { createOrgan } from '@coretex/organ-boot';
import { config } from './config.js';
import { initDatabase } from './db/init.js';
import { createResultsRouter } from './routes/results.js';
import { createTestsRouter } from './routes/tests.js';
import { createHealthLogRouter } from './routes/health-log.js';
import { handleDirectedMessage } from './handlers/messages.js';
import { loadRegistry } from './engine/registry.js';
import { createRunner } from './engine/runner.js';
import { startScheduler, stopScheduler } from './engine/scheduler.js';
import { buildTriggerFilters, handleTriggerEvent } from './triggers/filters.js';

function log(event, data = {}) {
  const entry = { timestamp: new Date().toISOString(), event, ...data };
  process.stdout.write(JSON.stringify(entry) + '\n');
}

// Initialize database (fail fast)
const dbPath = resolve(config.dbPath);
const db = initDatabase(dbPath);

const conceptCount = db.prepare('SELECT COUNT(*) as count FROM concepts').get().count;
log('db_initialized', { path: dbPath, concepts: conceptCount });

// Load CV registry
let registry = [];
try {
  registry = loadRegistry(config.registryPath);
  log('registry_loaded', { tests: registry.length, path: config.registryPath });
} catch (err) {
  log('registry_load_error', { error: err.message, path: config.registryPath });
}

// Create test runner (persists results via local DB)
const runner = createRunner(db, registry);

// Build Spine subscription filters from deterministic triggers in registry
const subscriptions = buildTriggerFilters(registry);

// Boot organ
const organ = await createOrgan({
  name: 'Vigil',
  port: config.port,
  binding: config.binding,
  spineUrl: config.spineUrl,

  routes: (app) => {
    app.use('/tests', createResultsRouter(db));
    app.use('/tests', createTestsRouter(db));
    app.use('/health-log', createHealthLogRouter(db));

    // New: run tests via HTTP
    app.post('/tests/run', async (req, res) => {
      const { scope, group, tier, test_id } = req.body || {};
      try {
        const results = await runner.run({ scope: scope || 'all', group, tier, test_id, triggered_by: 'manual' });
        res.json({ results, triggered_by: 'manual' });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  },

  onMessage: (envelope) => handleDirectedMessage(envelope, runner, db),

  onBroadcast: (envelope) => handleTriggerEvent(envelope, registry, runner),

  subscriptions,

  dependencies: ['Spine'],

  healthCheck: async () => {
    let dbConnected = true;
    let testsRegistered = 0;
    try {
      const row = db.prepare(
        "SELECT COUNT(*) as count FROM concepts WHERE json_extract(data, '$.type') = 'test_definition'"
      ).get();
      testsRegistered = row.count;
    } catch {
      dbConnected = false;
    }
    return {
      db_connected: dbConnected,
      tests_registered: testsRegistered,
      registry_loaded: registry.length > 0,
      registry_tests: registry.length,
      scheduler_enabled: config.schedulerEnabled,
    };
  },

  introspectCheck: async () => {
    const totalResults = db.prepare(
      "SELECT COUNT(*) as count FROM concepts WHERE json_extract(data, '$.type') = 'verification_result'"
    ).get().count;
    const healthLogEntries = db.prepare(
      'SELECT COUNT(*) as count FROM health_log'
    ).get().count;
    const schemaVersion = db.prepare(
      "SELECT value FROM op_config WHERE key = 'schema_version'"
    ).get();
    return {
      total_results: totalResults,
      health_log_entries: healthLogEntries,
      schema_version: schemaVersion ? schemaVersion.value : null,
      registry_tests: registry.length,
      db_path: db.name,
    };
  },

  onStartup: async () => {
    if (config.schedulerEnabled) {
      startScheduler(registry, runner);
      log('scheduler_started');
    }
  },

  onShutdown: async () => {
    stopScheduler();
    db.close();
  },
});
