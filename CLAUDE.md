# Vigil — Continuous Verification Organ

## Identity

- **Organ:** Vigil (#120)
- **Profile:** Deterministic
- **MP-3 deliverable:** data plane (encapsulated database + HTTP API)
- **MP-4 deliverable:** organ-boot refactor, test execution engine, Spine connectivity, live loop

## Current State (MP-4)

Full organ implementation: SQLite database with graph-native concepts, HTTP API for test result storage/retrieval, test registration, independent health log, diagnostics. Test execution engine with Vigil registry parsing, 14 reimplemented test functions, Spine-connected live loop with deterministic triggering and directed message handling.

**Engine capabilities:**
- Vigil registry YAML parsing (via python3 yaml.safe_load)
- 14 test functions: db-sqlite-online, db-radiant-online, db-radiant-rw, db-aosweb-online, radiant-boot-cache, radiant-dream-fresh, capture-unprocessed, capture-event-count, symlinks-resolve, launchagent-all-loaded, spine-server-running, spine-launchagent-loaded, backup-state-fresh, auth-session-token
- Test result persistence (latest + historical dual URN)
- Spine message handlers: run_tests, test_trigger, query_results
- Spine broadcast subscriptions for deterministic trigger events
- Optional internal scheduler (VIGIL_SCHEDULER_ENABLED=true)

**Pending (future):**
- Full test coverage (remaining ~74 tests from Vigil registry)
- LaunchAgent configuration
- Freshness contract enforcement and staleness classification
- Parallel test execution

## Running

```bash
npm start       # Start server (port 4015 AOS / 3915 SAAS)
npm test        # Run unit tests (63 tests)
npm run seed    # Populate vigil.db from monolith ai-kb.db
```

## Ports

| Environment | Port |
|---|---|
| AOS (development) | 4015 |
| SAAS (production) | 3915 |

## Database

- **Path:** `data/vigil.db` (gitignored)
- **Tables:** `concepts` (graph-native), `health_log` (independent), `op_config` (schema versioning)
- **WAL mode** with 5000ms busy_timeout

## Key Principle

The independent health log (`health_log` table) must survive Graph/Graphheight failures. It is intentionally separate from the concept model and must never be merged into any shared database.

## Conventions

- ES modules (`import`/`export`)
- Node.js built-in test runner (`node:test`, `node:assert/strict`)
- Router factory functions with dependency injection
- In-memory SQLite (`:memory:`) for test isolation
- Structured JSON logging to stdout
- URN format: `urn:llm-ops:verification:{namespace}:{identifier}`
- organ-boot factory (`createOrgan()`) for lifecycle management
