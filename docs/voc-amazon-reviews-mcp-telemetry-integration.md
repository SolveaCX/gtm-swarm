# voc-amazon-reviews MCP Telemetry Integration

This document is for the `voc-amazon-reviews-mcp` owner who wants to push telemetry into GTM Swarm.

## Endpoint

Production server:

```text
https://gtm.shulex.com
```

Push endpoint:

```text
POST https://gtm.shulex.com/api/swarm/ingest
Authorization: Bearer <GTM_SWARM_TOKEN>
Content-Type: application/json
```

Ask the GTM Swarm owner for:

- `workspace` slug to use for the integration
- the workspace `swarm_token` copied from the GTM Swarm project card
- stable `node_id` naming convention

## Service Identity

Use:

```text
service.name = voc-amazon-reviews-mcp
agent_key = voc-amazon-reviews-mcp
platform = mcp
```

Recommended environment:

```bash
export GTM_SWARM_SERVER="https://gtm.shulex.com"
export GTM_SWARM_TOKEN="<workspace swarm_token>"
export GTM_SWARM_WORKSPACE="voc-ai"
export GTM_SWARM_AGENT="voc-amazon-reviews-mcp"
export GTM_SWARM_NODE="vercel-prod"
```

`GTM_SWARM_TOKEN` should be the copied workspace token. GTM Swarm also supports a server-wide admin token for internal operations, but external integrations should use the workspace token.

## JSON Model

GTM Swarm stores durable telemetry objects as `artifacts` and point-in-time measurements as `observations`.

For MCP telemetry, use one artifact per MCP call:

```text
artifact_type = mcp_tool_call
external_id = globally unique invocation id
```

If there is no invocation id, generate one:

```text
{timestamp_ms}-{client_instance_id}-{tool}-{random_suffix}
```

Store dimensions in `artifact.payload`. Store numeric values in `observation.metrics`.

## Required Dimensions

Send these fields inside each artifact `payload`:

| Field | Example |
| --- | --- |
| `service_name` | `voc-amazon-reviews-mcp` |
| `metric_name` | `mcp_tool_calls_total` |
| `tool` | `fetch_reviews` |
| `status` | `ok` or `error` |
| `client` | `claude-code` |
| `error_type` | `timeout` |
| `source_catalog` | `amazon-us` |
| `client_instance_id` | `client_abc123` |
| `business_success` | `true` or `false` |

Allowed tool values:

- `fetch_reviews`
- `analyze_reviews`
- `voc_full`
- `extract_listing_improvements`
- `analyze_csv`
- `render_dashboard`

## Tool Call Payload

Send one batch per call, or buffer calls and send a batch periodically.

```json
{
  "schema_version": "swarm.telemetry.v1",
  "workspace": "voc-ai",
  "agent_key": "voc-amazon-reviews-mcp",
  "node_id": "vercel-prod",
  "sent_at": "2026-05-25T10:00:02Z",
  "artifacts": [
    {
      "platform": "mcp",
      "artifact_type": "mcp_tool_call",
      "external_id": "1766656800000-client_abc123-fetch_reviews-a8f21c",
      "title": "fetch_reviews ok",
      "created_at": "2026-05-25T10:00:00Z",
      "payload": {
        "service_name": "voc-amazon-reviews-mcp",
        "metric_name": "mcp_tool_calls_total",
        "tool": "fetch_reviews",
        "status": "ok",
        "client": "claude-code",
        "error_type": "",
        "source_catalog": "amazon-us",
        "client_instance_id": "client_abc123",
        "business_success": true,
        "route": "POST /mcp",
        "http_status": 200
      }
    }
  ],
  "observations": [
    {
      "platform": "mcp",
      "artifact_type": "mcp_tool_call",
      "external_id": "1766656800000-client_abc123-fetch_reviews-a8f21c",
      "observed_at": "2026-05-25T10:00:02Z",
      "metrics": {
        "calls": 1,
        "latency_ms": 842,
        "business_success": 1,
        "http_2xx": 1,
        "http_4xx": 0,
        "http_5xx": 0
      }
    }
  ]
}
```

For failed business outcomes:

```json
{
  "payload": {
    "status": "ok",
    "business_success": false,
    "error_type": "no_reviews_found"
  },
  "metrics": {
    "calls": 1,
    "latency_ms": 1204,
    "business_success": 0
  }
}
```

For transport/tool errors:

```json
{
  "payload": {
    "status": "error",
    "business_success": false,
    "error_type": "timeout"
  },
  "metrics": {
    "calls": 1,
    "latency_ms": 30000,
    "business_success": 0
  }
}
```

## Vercel Route Health

For `POST /mcp` health, send a separate artifact type:

```json
{
  "platform": "mcp",
  "artifact_type": "vercel_route_request",
  "external_id": "1766656800000-post-mcp-200-client_abc123",
  "title": "POST /mcp 200",
  "created_at": "2026-05-25T10:00:00Z",
  "payload": {
    "service_name": "voc-amazon-reviews-mcp",
    "route": "POST /mcp",
    "http_status": 200,
    "client": "claude-code",
    "client_instance_id": "client_abc123"
  }
}
```

Observation:

```json
{
  "platform": "mcp",
  "artifact_type": "vercel_route_request",
  "external_id": "1766656800000-post-mcp-200-client_abc123",
  "observed_at": "2026-05-25T10:00:02Z",
  "metrics": {
    "requests": 1,
    "http_2xx": 1,
    "http_4xx": 0,
    "http_5xx": 0,
    "latency_ms": 842
  }
}
```

## Dashboard Panels Requested

The following panels can be produced from the payload above:

| Panel | Source |
| --- | --- |
| Total call volume trend | count `mcp_tool_call` artifacts over time |
| Calls by tool | group by `payload.tool` |
| Overall error rate | `payload.status = error` / all calls |
| Error rate by tool | group by `payload.tool`, filter `status` |
| p50/p95 latency by tool | percentile over `metrics.latency_ms`, group by `payload.tool` |
| Top clients | group by `payload.client` |
| Error type distribution | group by `payload.error_type` |
| Business success rate by tool | avg `metrics.business_success`, group by `payload.tool` |
| Source catalog distribution | group by `payload.source_catalog` |
| Daily active client instances | distinct `payload.client_instance_id` per day |
| Vercel route health | sum `http_2xx`, `http_4xx`, `http_5xx` for `vercel_route_request` |

## Retention and Funnel Data

If Redis retention data is available, push a daily summary artifact once per day.

Artifact:

```json
{
  "platform": "mcp",
  "artifact_type": "mcp_retention_daily",
  "external_id": "2026-05-25-amazon-us",
  "title": "Retention amazon-us 2026-05-25",
  "created_at": "2026-05-25T23:59:00Z",
  "payload": {
    "service_name": "voc-amazon-reviews-mcp",
    "source_catalog": "amazon-us",
    "day": "2026-05-25",
    "redis_install_key": "mcp:voc:install:2026-05-25:amazon-us",
    "redis_active_key": "mcp:voc:active:2026-05-25"
  }
}
```

Observation:

```json
{
  "platform": "mcp",
  "artifact_type": "mcp_retention_daily",
  "external_id": "2026-05-25-amazon-us",
  "observed_at": "2026-05-25T23:59:00Z",
  "metrics": {
    "installs": 20,
    "active_clients": 8,
    "d1_retained": 5,
    "d7_retained": 2,
    "d30_retained": 1
  }
}
```

## CLI Smoke Test

From `gtm-swarm-cli/`:

```bash
node bin/gtm-swarm.js validate examples/x-agent-batch.json
```

Push a real MCP batch:

```bash
node bin/gtm-swarm.js push batch ./voc-mcp-batch.json
```

Expected success:

```json
{
  "ok": true,
  "artifacts": {
    "upserted": 1
  },
  "observations": {
    "inserted": 1
  }
}
```

## Integration Checklist

- Confirm `workspace` slug with GTM Swarm owner.
- Confirm the workspace `swarm_token`.
- Send one valid test batch to `https://gtm.shulex.com/api/swarm/ingest`.
- Share the generated `external_id`.
- GTM Swarm owner verifies the row in report/storage.
- Send 20 to 50 mixed calls across at least 3 tools and 2 clients.
- GTM Swarm owner builds the MCP-specific report page from the grouped dimensions.
