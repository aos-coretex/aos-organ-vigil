import { Router } from 'express';

export function createHealthRouter(db, startTime) {
  const router = Router();

  // GET /health — heartbeat
  router.get('/health', (_req, res) => {
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

    const uptimeS = Math.floor((Date.now() - startTime) / 1000);
    const status = dbConnected ? 'ok' : 'degraded';

    res.json({
      status,
      uptime_s: uptimeS,
      db_connected: dbConnected,
      tests_registered: testsRegistered,
    });
  });

  // GET /introspect — diagnostics
  router.get('/introspect', (_req, res) => {
    const testsRegistered = db.prepare(
      "SELECT COUNT(*) as count FROM concepts WHERE json_extract(data, '$.type') = 'test_definition'"
    ).get().count;

    const totalResults = db.prepare(
      "SELECT COUNT(*) as count FROM concepts WHERE json_extract(data, '$.type') = 'verification_result'"
    ).get().count;

    const healthLogEntries = db.prepare(
      'SELECT COUNT(*) as count FROM health_log'
    ).get().count;

    const lastResultRow = db.prepare(
      "SELECT json_extract(data, '$.timestamp') as ts FROM concepts WHERE json_extract(data, '$.type') = 'verification_result' ORDER BY created_at DESC LIMIT 1"
    ).get();

    const schemaVersion = db.prepare(
      "SELECT value FROM op_config WHERE key = 'schema_version'"
    ).get();

    res.json({
      tests_registered: testsRegistered,
      total_results: totalResults,
      health_log_entries: healthLogEntries,
      last_result_ts: lastResultRow ? lastResultRow.ts : null,
      schema_version: schemaVersion ? schemaVersion.value : null,
      db_path: db.name,
    });
  });

  return router;
}
