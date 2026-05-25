# Swarm Telemetry Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved swarm telemetry system end to end: DB storage, ingest/report/job APIs, a standalone CLI subfolder, and an X agent dashboard page.

**Architecture:** Add focused server modules for validation, ingestion, reporting, and jobs. Store durable agent work in `swarm_artifacts`, metric snapshots in `swarm_observations`, and server-pulled work in `swarm_jobs`. Add a new `gtm-swarm-cli/` package that speaks the same JSON contract documented in the spec.

**Tech Stack:** Next.js App Router, Node 22 ESM, PostgreSQL via existing `pg`, React 19, CSS modules by page-level CSS import, Node built-in test runner.

---

## File Structure

- Modify: `migrations/001-initial.sql` — add swarm tables and indexes.
- Create: `server/swarm-schema.js` — validate telemetry batches, job completions, and CLI-compatible payloads.
- Create: `server/swarm-store.js` — ingest artifacts/observations, create/lease/complete jobs, and run report queries.
- Create: `server/swarm-report.js` — define the X report DSL and render widgets from store query outputs.
- Create: `app/api/swarm/ingest/route.ts` — batch ingest endpoint.
- Create: `app/api/swarm/report/route.ts` — report endpoint.
- Create: `app/api/swarm/jobs/route.ts` — job creation endpoint.
- Create: `app/api/swarm/jobs/lease/route.ts` — node lease endpoint.
- Create: `app/api/swarm/jobs/[id]/complete/route.ts` — job completion endpoint.
- Create: `app/dashboard/[slug]/swarm/page.tsx` — X swarm dashboard page.
- Create: `app/dashboard/[slug]/swarm/SwarmDashboard.css` — dashboard styles.
- Create: `gtm-swarm-cli/package.json` — CLI package metadata.
- Create: `gtm-swarm-cli/bin/gtm-swarm.js` — command entrypoint.
- Create: `gtm-swarm-cli/src/client.js` — HTTP client.
- Create: `gtm-swarm-cli/src/schema.js` — CLI-side validation re-export/copy.
- Create: `gtm-swarm-cli/src/commands/push.js` — push commands.
- Create: `gtm-swarm-cli/src/commands/node.js` — node runner.
- Create: `gtm-swarm-cli/README.md` — CLI usage.
- Create: `gtm-swarm-cli/specs/agent-json-contract.md` — short AI-facing contract copied from design.
- Create: `gtm-swarm-cli/examples/x-agent-batch.json` — valid batch example.
- Create: `gtm-swarm-cli/examples/x-observation-job-result.json` — valid job completion example.
- Create: `server/swarm-schema.test.js` — Node tests for validation.
- Create: `server/swarm-report.test.js` — Node tests for report shaping with mocked store outputs.

## Tasks

### Task 1: Database Migration

**Files:**
- Modify: `migrations/001-initial.sql`

- [ ] Add `swarm_artifacts`, `swarm_observations`, and `swarm_jobs`.
- [ ] Add unique constraints that make artifact upsert and observation idempotency deterministic.
- [ ] Add indexes for workspace/platform/type/time report queries.
- [ ] Keep migration idempotent with `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`.
- [ ] Run: `npm run build`
- [ ] Expected: build reaches application compilation or fails only on later not-yet-created imports before subsequent tasks.

### Task 2: Validation Module

**Files:**
- Create: `server/swarm-schema.js`
- Create: `server/swarm-schema.test.js`

- [ ] Implement `validateTelemetryBatch(input)` returning `{ ok: true, batch }` or `{ ok: false, error }`.
- [ ] Implement `validateJobCompletion(input)` returning normalized completed/failed payloads.
- [ ] Validate required fields and numeric metrics exactly as the design spec states.
- [ ] Write Node tests for valid X batch, missing workspace, invalid metric string, and failed job completion.
- [ ] Run: `node --test server/swarm-schema.test.js`
- [ ] Expected: all tests pass.

### Task 3: Store Module

**Files:**
- Create: `server/swarm-store.js`

- [ ] Implement `authorizeSwarmRequest(request)` with `GTM_SWARM_TOKEN` bearer behavior.
- [ ] Implement `ingestTelemetryBatch(batch)` that resolves workspace, upserts artifacts, and inserts observations.
- [ ] Implement `createSwarmJob(input)`.
- [ ] Implement `leaseSwarmJob({ workspace, node_id, agent_key, lease_seconds })`.
- [ ] Implement `completeSwarmJob(id, completion)`.
- [ ] Implement report query helpers:
  - `countArtifactsByType({ workspace, platform, from, to })`
  - `latestMetricLeaderboard({ workspace, platform, artifact_type, metrics, limit })`
  - `metricDeltaLeaderboard({ workspace, platform, artifact_type, metrics, from, to, limit })`
- [ ] Keep SQL parameterized.

### Task 4: Report Module

**Files:**
- Create: `server/swarm-report.js`
- Create: `server/swarm-report.test.js`

- [ ] Define `buildXReportSpec({ workspace, from, to, platform })`.
- [ ] Implement `renderXReport({ workspace, from, to, platform })`.
- [ ] Return one JSON shape that the dashboard can render directly:
  - `range`
  - `today_work`
  - `post_total_leaderboard`
  - `reply_total_leaderboard`
  - `post_delta_leaderboard`
  - `reply_delta_leaderboard`
- [ ] Unit-test report shaping with mocked query functions.
- [ ] Run: `node --test server/swarm-report.test.js`
- [ ] Expected: all tests pass.

### Task 5: API Routes

**Files:**
- Create: `app/api/swarm/ingest/route.ts`
- Create: `app/api/swarm/report/route.ts`
- Create: `app/api/swarm/jobs/route.ts`
- Create: `app/api/swarm/jobs/lease/route.ts`
- Create: `app/api/swarm/jobs/[id]/complete/route.ts`

- [ ] Wire validation and store functions into route handlers.
- [ ] Return the exact status codes from the design spec.
- [ ] Ensure job completion ingests embedded `batch` before marking completed.
- [ ] Use existing `hasDB()` guard and return `503` if `GTM_DATABASE` is missing.

### Task 6: CLI Subpackage

**Files:**
- Create all `gtm-swarm-cli/` files listed above.

- [ ] Implement dependency-free Node 22 CLI argument parsing.
- [ ] Implement `push batch`.
- [ ] Implement `push artifact`.
- [ ] Implement `push observation`.
- [ ] Implement `node run --handler ./handler.js` with lease loop.
- [ ] Add examples that validate against the same JSON rules.
- [ ] Run: `node gtm-swarm-cli/bin/gtm-swarm.js help`
- [ ] Expected: usage output includes push and node commands.
- [ ] Run: `node gtm-swarm-cli/bin/gtm-swarm.js validate gtm-swarm-cli/examples/x-agent-batch.json`
- [ ] Expected: valid.

### Task 7: Dashboard Page

**Files:**
- Create: `app/dashboard/[slug]/swarm/page.tsx`
- Create: `app/dashboard/[slug]/swarm/SwarmDashboard.css`

- [ ] Build a client page with range controls defaulting to current local day.
- [ ] Fetch `/api/swarm/report?workspace={slug}&from={from}&to={to}&platform=x`.
- [ ] Render stat cards and four leaderboards.
- [ ] Keep layout dense, operational, and consistent with existing dashboard styling.
- [ ] Show empty states without marketing copy.

### Task 8: Verification

**Files:**
- All touched files.

- [ ] Run: `node --test server/swarm-schema.test.js server/swarm-report.test.js`
- [ ] Run: `npm run build`
- [ ] If a local database is configured, run a CLI push against local server and open `/dashboard/{slug}/swarm`.
- [ ] If no local database is configured, document that DB-backed endpoint verification was not run.
- [ ] Run: `git status --short` and confirm only intended files plus pre-existing user changes are present.

