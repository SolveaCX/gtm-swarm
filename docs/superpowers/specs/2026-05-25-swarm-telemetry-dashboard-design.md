# Swarm Telemetry Dashboard Design

**Date:** 2026-05-25
**Status:** Approved

## Goal

Build an end-to-end telemetry layer for GTM Swarm agents:

- agents can push work results and metric snapshots from local machines;
- the server can store, query, and render those results;
- the server can lease collection jobs to agent nodes and receive completion results;
- AI-driven agent nodes can understand the JSON contract quickly and produce valid payloads.

The first production slice targets an X agent that creates posts/replies and later collects views/replies for those historical objects.

## Non-Goals

- Do not replace existing content pipeline tabs.
- Do not build a generic BI product.
- Do not implement browser scraping logic inside the server.
- Do not force all agents into one workflow engine.
- Do not require Prometheus, Grafana, Langfuse, or other external observability platforms.

## Architecture

```
agent process / browser collector
  -> gtm-swarm-cli
  -> POST /api/swarm/ingest
  -> swarm_artifacts + swarm_observations
  -> /api/swarm/report?workspace=...&from=...&to=...
  -> /dashboard/[slug]/swarm

server job creator
  -> swarm_jobs
  -> agent node leases job via CLI
  -> local handler collects data
  -> CLI completes job and pushes observations
```

The system separates actual produced work from later observed metrics:

- `swarm_artifacts` stores durable platform objects such as X posts and X replies.
- `swarm_observations` stores point-in-time metric snapshots for an artifact.
- `swarm_jobs` stores server-created work that agent nodes can lease and complete.

This supports both push-first agents and server-requested collection jobs.

## Data Model

### `swarm_artifacts`

An artifact is something an agent actually created or discovered.

Required identity:

- `workspace_id`
- `agent_key`
- `platform`
- `artifact_type`
- `external_id`

Recommended unique key:

```sql
UNIQUE (workspace_id, platform, artifact_type, external_id)
```

Columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | UUID | Internal artifact ID |
| `workspace_id` | UUID | FK to `workspaces.id` |
| `agent_key` | TEXT | Stable local agent name, e.g. `x-growth-agent` |
| `node_id` | TEXT | Machine/node that produced the artifact |
| `platform` | TEXT | Platform namespace, e.g. `x`, `reddit`, `blog` |
| `artifact_type` | TEXT | Type inside platform, e.g. `post`, `reply` |
| `external_id` | TEXT | Platform/source object ID |
| `url` | TEXT | Canonical URL if available |
| `title` | TEXT | Human-readable label |
| `body` | TEXT | Optional content body |
| `created_at` | TIMESTAMPTZ | When the artifact was produced |
| `source_time` | TIMESTAMPTZ | Platform-side timestamp if different |
| `payload` | JSONB | Source-specific structured fields |
| `updated_at` | TIMESTAMPTZ | Last server update |

### `swarm_observations`

An observation is a snapshot of metrics for an artifact at a specific time.

Columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | UUID | Internal observation ID |
| `workspace_id` | UUID | FK to `workspaces.id` |
| `artifact_id` | UUID | FK to `swarm_artifacts.id` |
| `agent_key` | TEXT | Agent that collected the observation |
| `node_id` | TEXT | Machine/node that collected the observation |
| `observed_at` | TIMESTAMPTZ | When values were observed |
| `metrics` | JSONB | Numeric metrics, e.g. `{ "views": 1200, "replies": 9 }` |
| `payload` | JSONB | Raw/extra source-specific fields |
| `created_at` | TIMESTAMPTZ | Server insertion time |

Metric values in `metrics` must be numbers. Unknown non-numeric data goes into `payload`.

### `swarm_jobs`

A job is server-side work that one agent node can lease.

Columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | UUID | Job ID |
| `workspace_id` | UUID | FK to `workspaces.id` |
| `kind` | TEXT | e.g. `collect_observations` |
| `agent_key` | TEXT | Intended agent |
| `platform` | TEXT | Platform namespace |
| `status` | TEXT | `queued`, `leased`, `completed`, `failed`, `expired` |
| `priority` | INT | Higher runs first |
| `lease_node_id` | TEXT | Node that leased it |
| `lease_expires_at` | TIMESTAMPTZ | Lease timeout |
| `attempts` | INT | Lease/completion attempts |
| `target` | JSONB | Job-specific target data |
| `result` | JSONB | Completion result summary |
| `error` | TEXT | Failure reason |
| `created_at` | TIMESTAMPTZ | Creation time |
| `updated_at` | TIMESTAMPTZ | Last update |

## Agent JSON Contract

This section is the quick-start standard for AI agent nodes. If an AI agent only reads one part of this document, it should read this section.

### Common Rules

- All timestamps must be ISO 8601 strings with timezone, preferably UTC with `Z`.
- `workspace` is the GTM workspace slug, e.g. `flatkey`.
- `agent_key` is a stable machine-readable agent name, e.g. `x-reply-agent`.
- `node_id` is a stable machine name, e.g. `mac-mini-01`.
- `platform` is lowercase, e.g. `x`.
- `artifact_type` is lowercase, e.g. `post` or `reply`.
- `external_id` is required for every artifact and should match the platform/source ID.
- Metric values must be numeric. Use `payload` for strings, arrays, booleans, nested metadata, and raw scraped data.
- Payloads should be idempotent. Re-sending the same artifact updates the artifact; re-sending observations appends a new snapshot unless `observed_at` matches an existing snapshot for the same artifact.

### Batch Envelope

The preferred push format is a batch. It can contain artifacts, observations, or both.

```json
{
  "schema_version": "swarm.telemetry.v1",
  "workspace": "flatkey",
  "agent_key": "x-growth-agent",
  "node_id": "mac-mini-01",
  "sent_at": "2026-05-25T09:30:00Z",
  "artifacts": [],
  "observations": []
}
```

### Artifact

Use an artifact when the agent created or discovered a durable object.

```json
{
  "platform": "x",
  "artifact_type": "post",
  "external_id": "1794312345678900000",
  "url": "https://x.com/acme/status/1794312345678900000",
  "title": "Launch update",
  "body": "We shipped a new API key flow today.",
  "created_at": "2026-05-25T08:10:00Z",
  "source_time": "2026-05-25T08:09:52Z",
  "payload": {
    "account": "@acme",
    "campaign": "api-key-launch",
    "language": "en"
  }
}
```

Minimal valid artifact:

```json
{
  "platform": "x",
  "artifact_type": "reply",
  "external_id": "1794312345678900001",
  "created_at": "2026-05-25T08:12:00Z"
}
```

### Observation

Use an observation when the agent collects current metrics for an artifact.

Preferred observation format references the artifact by platform identity:

```json
{
  "platform": "x",
  "artifact_type": "post",
  "external_id": "1794312345678900000",
  "observed_at": "2026-05-25T09:25:00Z",
  "metrics": {
    "views": 1834,
    "replies": 12,
    "likes": 44,
    "reposts": 7
  },
  "payload": {
    "raw_labels": {
      "views": "1,834",
      "replies": "12"
    }
  }
}
```

Minimal valid observation:

```json
{
  "platform": "x",
  "artifact_type": "reply",
  "external_id": "1794312345678900001",
  "observed_at": "2026-05-25T09:25:00Z",
  "metrics": {
    "views": 321,
    "replies": 1
  }
}
```

### Complete X Agent Batch Example

```json
{
  "schema_version": "swarm.telemetry.v1",
  "workspace": "flatkey",
  "agent_key": "x-growth-agent",
  "node_id": "mac-mini-01",
  "sent_at": "2026-05-25T09:30:00Z",
  "artifacts": [
    {
      "platform": "x",
      "artifact_type": "post",
      "external_id": "1794312345678900000",
      "url": "https://x.com/acme/status/1794312345678900000",
      "body": "We shipped a new API key flow today.",
      "created_at": "2026-05-25T08:10:00Z",
      "payload": {
        "account": "@acme"
      }
    },
    {
      "platform": "x",
      "artifact_type": "reply",
      "external_id": "1794312345678900001",
      "url": "https://x.com/acme/status/1794312345678900001",
      "body": "Thanks for the feedback. We added this to the roadmap.",
      "created_at": "2026-05-25T08:12:00Z",
      "payload": {
        "account": "@acme",
        "reply_to_external_id": "1794300000000000000"
      }
    }
  ],
  "observations": [
    {
      "platform": "x",
      "artifact_type": "post",
      "external_id": "1794312345678900000",
      "observed_at": "2026-05-25T09:25:00Z",
      "metrics": {
        "views": 1834,
        "replies": 12
      }
    },
    {
      "platform": "x",
      "artifact_type": "reply",
      "external_id": "1794312345678900001",
      "observed_at": "2026-05-25T09:25:00Z",
      "metrics": {
        "views": 321,
        "replies": 1
      }
    }
  ]
}
```

### Job Lease Response

When a node asks the server for work, it receives either no job or one job.

No job:

```json
{
  "job": null
}
```

Collection job:

```json
{
  "job": {
    "id": "7bb9e857-71da-4c61-905f-3c42f7397dc7",
    "kind": "collect_observations",
    "workspace": "flatkey",
    "agent_key": "x-growth-agent",
    "platform": "x",
    "target": {
      "artifacts": [
        {
          "platform": "x",
          "artifact_type": "post",
          "external_id": "1794312345678900000",
          "url": "https://x.com/acme/status/1794312345678900000"
        }
      ],
      "params": {
        "browser": true
      }
    },
    "lease_expires_at": "2026-05-25T09:45:00Z"
  }
}
```

### Job Completion

Successful completion:

```json
{
  "status": "completed",
  "summary": "Collected 1 X post observation.",
  "batch": {
    "schema_version": "swarm.telemetry.v1",
    "workspace": "flatkey",
    "agent_key": "x-growth-agent",
    "node_id": "mac-mini-01",
    "sent_at": "2026-05-25T09:34:00Z",
    "artifacts": [],
    "observations": [
      {
        "platform": "x",
        "artifact_type": "post",
        "external_id": "1794312345678900000",
        "observed_at": "2026-05-25T09:33:30Z",
        "metrics": {
          "views": 1901,
          "replies": 13
        }
      }
    ]
  }
}
```

Failed completion:

```json
{
  "status": "failed",
  "summary": "Browser login expired.",
  "error": "x_session_expired"
}
```

## Report DSL

Reports are JSON specs. The first implementation ships with a fixed X report, but the query engine should use the same DSL internally so later dashboards are data-driven.

```json
{
  "schema_version": "swarm.report.v1",
  "title": "X Agent Dashboard",
  "params": {
    "workspace": "flatkey",
    "from": "2026-05-25T00:00:00Z",
    "to": "2026-05-25T23:59:59Z"
  },
  "widgets": [
    {
      "id": "today_work",
      "title": "Today's Work",
      "type": "stat_group",
      "query": {
        "kind": "artifact_counts",
        "platform": "x",
        "artifact_types": ["post", "reply"],
        "time_field": "created_at",
        "range": "$range"
      }
    },
    {
      "id": "post_total_leaderboard",
      "title": "Posts Total Ranking",
      "type": "leaderboard",
      "query": {
        "kind": "latest_metric_leaderboard",
        "platform": "x",
        "artifact_type": "post",
        "metrics": ["views", "replies"],
        "limit": 20
      }
    },
    {
      "id": "post_delta_leaderboard",
      "title": "Posts Delta Ranking",
      "type": "leaderboard",
      "query": {
        "kind": "metric_delta_leaderboard",
        "platform": "x",
        "artifact_type": "post",
        "metrics": ["views", "replies"],
        "range": "$range",
        "limit": 20
      }
    }
  ]
}
```

### Query Kinds

#### `artifact_counts`

Counts artifacts grouped by `artifact_type`.

Input:

- `platform`
- `artifact_types`
- `time_field`: first version supports `created_at`
- `range`: `$range`

Output:

```json
{
  "post": 4,
  "reply": 31
}
```

#### `latest_metric_leaderboard`

Finds the latest observation for each artifact and sorts by the first requested metric.

Input:

- `platform`
- `artifact_type`
- `metrics`
- `limit`

Output:

```json
[
  {
    "artifact_id": "uuid",
    "external_id": "1794312345678900000",
    "url": "https://x.com/acme/status/1794312345678900000",
    "title": "Launch update",
    "metrics": {
      "views": 1901,
      "replies": 13
    },
    "observed_at": "2026-05-25T09:33:30Z"
  }
]
```

#### `metric_delta_leaderboard`

For each artifact, compares the latest observation at or before `to` against the latest observation before `from`.

If there is no baseline observation before `from`, the baseline is zero.

Input:

- `platform`
- `artifact_type`
- `metrics`
- `range`: `$range`
- `limit`

Output:

```json
[
  {
    "artifact_id": "uuid",
    "external_id": "1794312345678900000",
    "url": "https://x.com/acme/status/1794312345678900000",
    "delta": {
      "views": 67,
      "replies": 1
    },
    "current": {
      "views": 1901,
      "replies": 13
    },
    "baseline": {
      "views": 1834,
      "replies": 12
    }
  }
]
```

## API Design

### `POST /api/swarm/ingest`

Accepts the batch envelope from the Agent JSON Contract.

Auth:

- First version uses `Authorization: Bearer <GTM_SWARM_TOKEN>`.
- If `GTM_SWARM_TOKEN` is unset, local development may accept unauthenticated requests.

Responses:

- `200 { "ok": true, "artifacts": { "upserted": 2 }, "observations": { "inserted": 2 } }`
- `400 { "error": "..." }`
- `401 { "error": "unauthorized" }`
- `404 { "error": "workspace not found" }`

### `GET /api/swarm/report`

Parameters:

- `workspace`: workspace slug
- `from`: ISO timestamp
- `to`: ISO timestamp
- `platform`: defaults to `x`

Returns rendered X dashboard data.

### `POST /api/swarm/jobs`

Creates a collection job.

Request:

```json
{
  "workspace": "flatkey",
  "kind": "collect_observations",
  "agent_key": "x-growth-agent",
  "platform": "x",
  "priority": 0,
  "target": {
    "artifacts": [
      {
        "platform": "x",
        "artifact_type": "post",
        "external_id": "1794312345678900000",
        "url": "https://x.com/acme/status/1794312345678900000"
      }
    ],
    "params": {
      "browser": true
    }
  }
}
```

### `GET /api/swarm/jobs/lease`

Parameters:

- `workspace`
- `node_id`
- `agent_key`
- `lease_seconds`: optional, defaults to `300`

Returns the job lease response described in the Agent JSON Contract.

### `POST /api/swarm/jobs/[id]/complete`

Accepts the job completion payload described in the Agent JSON Contract.

If completion contains `batch`, the server ingests the batch in the same transaction as marking the job completed.

## CLI Design

Create a new folder:

```text
gtm-swarm-cli/
  package.json
  README.md
  bin/gtm-swarm.js
  src/client.js
  src/commands/push.js
  src/commands/node.js
  src/schema.js
  specs/agent-json-contract.md
  examples/x-agent-batch.json
  examples/x-observation-job-result.json
```

Commands:

```bash
gtm-swarm push batch ./result.json
gtm-swarm push artifact --workspace flatkey --agent x-growth-agent --platform x --type post --external-id 179 --url https://x.com/... --body "..."
gtm-swarm push observation --workspace flatkey --agent x-growth-agent --platform x --type post --external-id 179 --metric views=1901 --metric replies=13
gtm-swarm node run --workspace flatkey --agent x-growth-agent --node mac-mini-01 --handler ./collect-x.js
```

Environment variables:

| Name | Meaning |
| --- | --- |
| `GTM_SWARM_SERVER` | Base URL, e.g. `https://gtm.example.com` |
| `GTM_SWARM_TOKEN` | Bearer token |
| `GTM_SWARM_WORKSPACE` | Default workspace |
| `GTM_SWARM_AGENT` | Default agent key |
| `GTM_SWARM_NODE` | Default node ID |

Node handler contract:

```js
export async function handleJob(job) {
  return {
    status: 'completed',
    summary: 'Collected observations',
    batch: {
      schema_version: 'swarm.telemetry.v1',
      workspace: job.workspace,
      agent_key: job.agent_key,
      node_id: process.env.GTM_SWARM_NODE || 'local',
      sent_at: new Date().toISOString(),
      artifacts: [],
      observations: []
    }
  }
}
```

## Dashboard

Add:

```text
app/dashboard/[slug]/swarm/page.tsx
app/dashboard/[slug]/swarm/SwarmDashboard.css
```

The page shows:

- time range controls;
- today's post/reply counts;
- historical post total ranking by views and replies;
- historical reply total ranking by views and replies;
- post delta ranking for selected range;
- reply delta ranking for selected range.

The page reads from:

```text
GET /api/swarm/report?workspace={slug}&from={iso}&to={iso}&platform=x
```

## Validation

Server-side validation rejects:

- unknown `schema_version`;
- missing `workspace`, `agent_key`, or `node_id`;
- artifacts missing `platform`, `artifact_type`, `external_id`, or `created_at`;
- observations missing `platform`, `artifact_type`, `external_id`, `observed_at`, or `metrics`;
- non-numeric metric values;
- observations that reference unknown artifacts, unless the same batch includes that artifact.

## Testing Strategy

- Unit-test JSON validation with valid and invalid examples.
- Unit-test report query functions against seeded artifacts/observations.
- API-test ingest and report endpoints.
- CLI smoke-test `push batch` against a local Next.js server.
- Browser-test `/dashboard/[slug]/swarm` with seeded data.

## Rollout

1. Add DB tables and server store functions.
2. Add shared validation and ingest API.
3. Add report query API.
4. Add CLI and examples.
5. Add dashboard page.
6. Add job lease/complete API and CLI node runner.

