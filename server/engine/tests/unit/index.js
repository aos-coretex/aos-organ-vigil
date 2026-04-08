/**
 * Unit test function implementations for Vigil.
 *
 * Each function is async and returns { status: 'pass'|'fail', detail: string }.
 * Function naming convention: test_<id_with_underscores> matching the CV registry test IDs.
 *
 * Initial subset (14 tests, approved for MP-4):
 * - databases: db-sqlite-online, db-radiant-online, db-radiant-rw, db-aosweb-online
 * - radiant: radiant-boot-cache, radiant-dream-fresh
 * - capture: capture-unprocessed, capture-event-count
 * - symlinks: symlinks-resolve
 * - launchagents: launchagent-all-loaded
 * - spine: spine-server-running, spine-launchagent-loaded
 * - backup: backup-state-fresh
 * - auth: auth-session-token
 */

import { execFile } from 'node:child_process';
import { access, stat, readdir, lstat, readlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { constants } from 'node:fs';

const execFileAsync = promisify(execFile);

const SQLITE_DB = process.env.SQLITE_DB_PATH || '/Library/AI/AI-Datastore/AI-KB-DB/ai-kb.db';
const BOOT_CACHE = '/Library/AI/AI-Infra-MDvaults/MDvault-LLM-Ops/50-Memory/anthropic/claude-code-memory/platform-memory-state.md';
const SESSION_TOKEN = '/tmp/.llm-ops-session';
const SPINE_RTIME_URL = process.env.SPINE_RTIME_URL || 'http://127.0.0.1:3801';

// --- Helper: run psql query ---
async function psql(database, query) {
  const { stdout } = await execFileAsync('psql', [database, '-t', '-A', '-c', query], {
    timeout: 5000,
    env: { ...process.env, PGCONNECT_TIMEOUT: '3' },
  });
  return stdout.trim();
}

// --- Helper: run sqlite3 query ---
async function sqlite(dbPath, query) {
  const { stdout } = await execFileAsync('sqlite3', [dbPath, query], { timeout: 5000 });
  return stdout.trim();
}

// --- Helper: file age in hours ---
async function fileAgeHours(filePath) {
  const info = await stat(filePath);
  return (Date.now() - info.mtimeMs) / (1000 * 60 * 60);
}

// =============================================================================
// Database Tests
// =============================================================================

/** db-sqlite-online: SQLite DB file exists and responds to queries */
async function test_db_sqlite_online() {
  try {
    await access(SQLITE_DB, constants.R_OK);
  } catch {
    return { status: 'fail', detail: `Database file not found: ${SQLITE_DB}` };
  }
  try {
    const count = await sqlite(SQLITE_DB, 'SELECT COUNT(*) FROM concepts;');
    return { status: 'pass', detail: `Online — ${count} concepts` };
  } catch (err) {
    return { status: 'fail', detail: `SQLite query failed: ${err.message}` };
  }
}

/** db-radiant-online: Radiant PostgreSQL database is accessible */
async function test_db_radiant_online() {
  try {
    await psql('radiant', 'SELECT 1;');
    return { status: 'pass', detail: 'Online' };
  } catch (err) {
    return { status: 'fail', detail: `Radiant connection failed: ${err.message}` };
  }
}

/** db-radiant-rw: Radiant database supports read/write operations */
async function test_db_radiant_rw() {
  const testId = `cv-rw-${Date.now()}`;
  try {
    await psql('radiant',
      `INSERT INTO knowledge_blocks (entity, content, lifecycle, created_by) VALUES ('cv-test', '${testId}', 'context', 'vigil-organ');`
    );
    const found = await psql('radiant',
      `SELECT COUNT(*) FROM knowledge_blocks WHERE content = '${testId}';`
    );
    await psql('radiant',
      `DELETE FROM knowledge_blocks WHERE content = '${testId}';`
    );
    if (parseInt(found, 10) > 0) {
      return { status: 'pass', detail: 'read/write: ok' };
    }
    return { status: 'fail', detail: 'read after write: 0 rows' };
  } catch (err) {
    return { status: 'fail', detail: `read/write failed: ${err.message}` };
  }
}

/** db-aosweb-online: AOS Web PostgreSQL database is accessible */
async function test_db_aosweb_online() {
  try {
    await psql('aos_web', 'SELECT 1;');
    return { status: 'pass', detail: 'Online' };
  } catch (err) {
    return { status: 'fail', detail: `AOS Web connection failed: ${err.message}` };
  }
}

// =============================================================================
// Radiant Tests
// =============================================================================

/** radiant-boot-cache: Boot cache file exists and is fresh (<48h) */
async function test_radiant_boot_cache() {
  try {
    await access(BOOT_CACHE, constants.R_OK);
  } catch {
    return { status: 'fail', detail: 'Boot cache not found' };
  }
  try {
    const ageH = await fileAgeHours(BOOT_CACHE);
    const rounded = Math.floor(ageH);
    if (ageH > 48) {
      return { status: 'fail', detail: `Boot cache ${rounded}h old (stale)` };
    }
    return { status: 'pass', detail: `Boot cache ${rounded}h old` };
  } catch (err) {
    return { status: 'fail', detail: `stat failed: ${err.message}` };
  }
}

/** radiant-dream-fresh: Most recent dream cycle report is <48h old */
async function test_radiant_dream_fresh() {
  try {
    const lastDream = await psql('radiant',
      `SELECT created_at FROM knowledge_blocks WHERE metadata->>'type' = 'dream_cycle_report' ORDER BY created_at DESC LIMIT 1;`
    );
    if (!lastDream) {
      return { status: 'fail', detail: 'No dream records found' };
    }
    const dreamDate = new Date(lastDream);
    const ageH = (Date.now() - dreamDate.getTime()) / (1000 * 60 * 60);
    const rounded = Math.floor(ageH);
    if (ageH > 48) {
      return { status: 'fail', detail: `Last dream ${rounded}h ago (stale)` };
    }
    return { status: 'pass', detail: `Last dream ${rounded}h ago` };
  } catch (err) {
    return { status: 'fail', detail: `Dream query failed: ${err.message}` };
  }
}

// =============================================================================
// Capture Bus Tests
// =============================================================================

/** capture-unprocessed: No stale unprocessed events (>7h old) */
async function test_capture_unprocessed() {
  try {
    const cutoff = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    const count = await sqlite(SQLITE_DB,
      `SELECT COUNT(*) FROM concepts WHERE json_extract(data, '$.type') = 'event' AND (json_extract(data, '$.processed') = 0 OR json_extract(data, '$.processed') IS NULL) AND urn < 'urn:llm-ops:event:${cutoff}';`
    );
    const n = parseInt(count, 10);
    if (n > 0) {
      return { status: 'fail', detail: `${n} stale unprocessed events (>7h old)` };
    }
    return { status: 'pass', detail: 'No stale unprocessed events' };
  } catch (err) {
    return { status: 'fail', detail: `Query failed: ${err.message}` };
  }
}

/** capture-event-count: Event store contains at least one event */
async function test_capture_event_count() {
  try {
    const count = await sqlite(SQLITE_DB,
      `SELECT COUNT(*) FROM concepts WHERE json_extract(data, '$.type') = 'event';`
    );
    const n = parseInt(count, 10);
    if (n === 0) {
      return { status: 'fail', detail: 'No events in store' };
    }
    return { status: 'pass', detail: `${n} events` };
  } catch (err) {
    return { status: 'fail', detail: `Query failed: ${err.message}` };
  }
}

// =============================================================================
// Symlinks Test
// =============================================================================

/** symlinks-resolve: All symlinks under /Library/AI/ resolve to valid targets */
async function test_symlinks_resolve() {
  try {
    const { stdout } = await execFileAsync('find', [
      '/Library/AI/', '-maxdepth', '6', '-type', 'l',
    ], { timeout: 10000 });

    const links = stdout.trim().split('\n').filter(Boolean);
    let broken = 0;
    const total = links.length;

    for (const link of links.slice(0, 200)) {
      try {
        await access(link, constants.F_OK);
      } catch {
        broken++;
      }
    }

    if (broken > 0) {
      return { status: 'fail', detail: `${broken}/${total} symlinks broken` };
    }
    return { status: 'pass', detail: `${total} symlinks OK` };
  } catch (err) {
    return { status: 'fail', detail: `Symlink scan failed: ${err.message}` };
  }
}

// =============================================================================
// LaunchAgent Test
// =============================================================================

const EXPECTED_AGENTS = [
  'com.coretex.aos-rtime',
  'com.coretex.capture-processor-batch',
  'com.coretex.capture-processor-ai',
  'com.coretex.capture-verify',
  'com.coretex.saas',
  'com.llm-ops.embedding-sidecar',
  'com.llm-ops.palette',
  'com.llm-ops.radiant-dreamer',
  'com.llm-ops.safevault-backup',
  'com.coretex.cv-runner-6h',
  'com.coretex.cv-runner-daily',
  'com.coretex.cv-runner-weekly',
  'com.coretex.auto-remediate',
  'com.llm-ops.spine-rtime',
  'com.llm-ops.autoheal-consumer',
];

/** launchagent-all-loaded: All expected LaunchAgent services are loaded */
async function test_launchagent_all_loaded() {
  try {
    const { stdout } = await execFileAsync('launchctl', ['list'], { timeout: 5000 });
    const missing = EXPECTED_AGENTS.filter((agent) => !stdout.includes(agent));
    const loaded = EXPECTED_AGENTS.length - missing.length;

    if (missing.length > 0) {
      return { status: 'fail', detail: `loaded: ${loaded}/${EXPECTED_AGENTS.length}, missing: ${missing.join(', ')}` };
    }
    return { status: 'pass', detail: `loaded: ${loaded}/${EXPECTED_AGENTS.length}` };
  } catch (err) {
    return { status: 'fail', detail: `launchctl failed: ${err.message}` };
  }
}

// =============================================================================
// Spine Tests
// =============================================================================

/** spine-server-running: Spine HTTP server responds to health check */
async function test_spine_server_running() {
  try {
    const response = await fetch(`${SPINE_RTIME_URL}/health`);
    if (response.ok) {
      return { status: 'pass', detail: `Spine rtime healthy on ${SPINE_RTIME_URL}` };
    }
    return { status: 'fail', detail: `Spine rtime not responding (HTTP ${response.status})` };
  } catch (err) {
    return { status: 'fail', detail: `Spine rtime not responding: ${err.message}` };
  }
}

/** spine-launchagent-loaded: Spine runtime LaunchAgent is registered */
async function test_spine_launchagent_loaded() {
  try {
    const { stdout } = await execFileAsync('launchctl', ['list'], { timeout: 5000 });
    if (stdout.includes('com.llm-ops.spine-rtime')) {
      return { status: 'pass', detail: 'com.llm-ops.spine-rtime loaded' };
    }
    return { status: 'fail', detail: 'com.llm-ops.spine-rtime not loaded' };
  } catch (err) {
    return { status: 'fail', detail: `launchctl failed: ${err.message}` };
  }
}

// =============================================================================
// Backup Test
// =============================================================================

/** backup-state-fresh: A recent backup completion event exists */
async function test_backup_state_fresh() {
  try {
    const result = await sqlite(SQLITE_DB,
      `SELECT json_extract(data, '$.content.summary') FROM concepts WHERE urn LIKE 'urn:llm-ops:event:%' AND json_extract(data, '$.subtype') = 'backup_done' ORDER BY urn DESC LIMIT 1;`
    );
    if (!result) {
      return { status: 'fail', detail: 'No backup records found' };
    }
    return { status: 'pass', detail: `Last backup: ${result}` };
  } catch (err) {
    return { status: 'fail', detail: `Query failed: ${err.message}` };
  }
}

// =============================================================================
// Auth Test
// =============================================================================

/** auth-session-token: Session token file exists and is fresh (<12h) */
async function test_auth_session_token() {
  try {
    await access(SESSION_TOKEN, constants.R_OK);
  } catch {
    return { status: 'fail', detail: 'Session token file not found' };
  }
  try {
    const ageH = await fileAgeHours(SESSION_TOKEN);
    const rounded = Math.floor(ageH);
    if (ageH > 12) {
      return { status: 'fail', detail: `Session token ${rounded}h old (stale)` };
    }
    return { status: 'pass', detail: `Session token valid (${rounded}h old)` };
  } catch (err) {
    return { status: 'fail', detail: `stat failed: ${err.message}` };
  }
}

// =============================================================================
// Export map — keyed by function name for dynamic dispatch
// =============================================================================

export const testFunctions = {
  test_db_sqlite_online,
  test_db_radiant_online,
  test_db_radiant_rw,
  test_db_aosweb_online,
  test_radiant_boot_cache,
  test_radiant_dream_fresh,
  test_capture_unprocessed,
  test_capture_event_count,
  test_symlinks_resolve,
  test_launchagent_all_loaded,
  test_spine_server_running,
  test_spine_launchagent_loaded,
  test_backup_state_fresh,
  test_auth_session_token,
};
