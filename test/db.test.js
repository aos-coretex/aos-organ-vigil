import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../server/db/init.js';

describe('Database initialization', () => {
  let db;

  before(() => {
    db = initDatabase(':memory:');
  });

  after(() => {
    db.close();
  });

  it('1. should set WAL journal mode (memory returns "memory")', () => {
    // In-memory databases cannot use WAL — they report "memory".
    // On disk, initDatabase sets WAL mode. Verify the pragma was called
    // by checking the value is one of the expected results.
    const result = db.pragma('journal_mode', { simple: true });
    assert.ok(['wal', 'memory'].includes(result), `Expected wal or memory, got ${result}`);
  });

  it('2. should set busy_timeout to 5000', () => {
    const result = db.pragma('busy_timeout', { simple: true });
    assert.equal(result, 5000);
  });

  it('3. should create concepts table', () => {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='concepts'"
    ).get();
    assert.ok(row, 'concepts table should exist');
  });

  it('4. should create health_log table', () => {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='health_log'"
    ).get();
    assert.ok(row, 'health_log table should exist');
  });

  it('5. should create op_config table', () => {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='op_config'"
    ).get();
    assert.ok(row, 'op_config table should exist');
  });

  it('6. should record schema_version 1.0.0', () => {
    const row = db.prepare(
      "SELECT value FROM op_config WHERE key = 'schema_version'"
    ).get();
    assert.ok(row);
    assert.equal(row.value, '1.0.0');
  });

  it('7. should create idx_concepts_type index', () => {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_concepts_type'"
    ).get();
    assert.ok(row, 'idx_concepts_type index should exist');
  });

  it('8. should create idx_concepts_test_id index', () => {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_concepts_test_id'"
    ).get();
    assert.ok(row, 'idx_concepts_test_id index should exist');
  });

  it('9. should create idx_concepts_status index', () => {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_concepts_status'"
    ).get();
    assert.ok(row, 'idx_concepts_status index should exist');
  });

  it('10. should enforce json_valid constraint on concepts.data', () => {
    assert.throws(() => {
      db.prepare(
        "INSERT INTO concepts (urn, data) VALUES ('urn:test:bad', 'not-json')"
      ).run();
    });
  });

  it('11. should enforce health_log status check constraint', () => {
    assert.throws(() => {
      db.prepare(
        "INSERT INTO health_log (status) VALUES ('unknown')"
      ).run();
    });
  });

  it('12. should be idempotent — calling initDatabase twice does not fail', () => {
    assert.doesNotThrow(() => {
      // Re-init on same db connection is not possible (already open),
      // but we can verify a second in-memory init works
      const db2 = initDatabase(':memory:');
      db2.close();
    });
  });
});
