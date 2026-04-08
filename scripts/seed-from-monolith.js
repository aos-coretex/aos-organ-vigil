import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { initDatabase } from '../server/db/init.js';

const sourcePath = resolve(process.env.SOURCE_DB_PATH || '/Library/AI/AI-Datastore/AI-KB-DB/ai-kb.db');
const targetPath = resolve(process.env.VIGIL_DB_PATH || './data/vigil.db');

function log(event, data = {}) {
  const entry = { timestamp: new Date().toISOString(), event, ...data };
  process.stdout.write(JSON.stringify(entry) + '\n');
}

try {
  const startMs = Date.now();

  log('seed_start', { source: sourcePath, target: targetPath });

  // Open source in read-only mode
  const sourceDb = new Database(sourcePath, { readonly: true });

  // Initialize target database (creates schema if needed)
  const targetDb = initDatabase(targetPath);

  // Query verification_result concepts from source
  const rows = sourceDb.prepare(
    "SELECT urn, data, created_at FROM concepts WHERE json_extract(data, '$.type') = 'verification_result'"
  ).all();

  log('seed_query_complete', { rows_found: rows.length });

  // Insert into target with INSERT OR IGNORE (idempotent)
  const insert = targetDb.prepare(
    'INSERT OR IGNORE INTO concepts (urn, data, created_at) VALUES (?, ?, ?)'
  );

  let migrated = 0;
  let skipped = 0;

  const transaction = targetDb.transaction(() => {
    for (const row of rows) {
      const result = insert.run(row.urn, row.data, row.created_at);
      if (result.changes > 0) {
        migrated++;
      } else {
        skipped++;
      }
    }
  });
  transaction();

  const elapsedMs = Date.now() - startMs;

  log('seed_complete', {
    migrated,
    skipped,
    total_source_rows: rows.length,
    elapsed_ms: elapsedMs,
  });

  sourceDb.close();
  targetDb.close();

  process.exit(0);
} catch (err) {
  log('seed_error', { error: err.message });
  process.exit(1);
}
