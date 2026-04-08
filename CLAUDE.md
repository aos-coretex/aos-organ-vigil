# Vigil — Continuous Verification Organ

## Identity

- **Organ:** Vigil (#120)
- **Profile:** Deterministic
- **MP-3 deliverable:** data plane (encapsulated database + HTTP API)

## Current State (MP-3)

This is the data-plane implementation: SQLite database with graph-native concepts, HTTP API for test result storage/retrieval, test registration, independent health log, and diagnostics.

**Pending (MP-4+):**
- Spine WebSocket connection, mailbox registration, event subscription
- Test execution engine (CV runner, YAML registry parsing, test function dispatch)
- Live loop (scheduled runs, deterministic triggering)
- LaunchAgent configuration
- Freshness contract enforcement and staleness classification

## Running

```bash
npm start       # Start server (port 4015 AOS / 3915 SAAS)
npm test        # Run unit tests
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

The independent health log (`health_log` table) must survive Graph/Graphheight failures. It is intentionally separate from the concept model and must never be merged into any shared database. This separation is the feature — when Graphheight is down, Vigil's health log is the last line of observability.

## Conventions

- ES modules (`import`/`export`)
- Node.js built-in test runner (`node:test`, `node:assert/strict`)
- Router factory functions with dependency injection (no `app.locals`)
- In-memory SQLite (`:memory:`) for test isolation
- Structured JSON logging to stdout
- URN format: `urn:llm-ops:verification:{namespace}:{identifier}`
