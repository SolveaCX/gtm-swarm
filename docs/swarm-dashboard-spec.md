# GTM Swarm Agent Dashboard Spec

Agents own metric collection. GTM Swarm stores what agents push and renders dashboards from the `dashboard_spec` pushed by each agent.

## Push Endpoint

```text
POST https://gtm.shulex.com/api/swarm/ingest
Authorization: Bearer <workspace swarm_token>
Content-Type: application/json
```

## Telemetry Envelope

```json
{
  "schema_version": "swarm.telemetry.v1",
  "workspace": "voc-ai",
  "agent_id": "support-agent-runtime",
  "agent_key": "support-agent",
  "node_id": "runtime-01",
  "sent_at": "2026-05-25T10:00:02Z",
  "dashboard_spec": {
    "schema_version": "swarm.dashboard.v1",
    "title": "Support Agent Report",
    "description": "Agent-collected ticket outcomes.",
    "widgets": [
      {
        "id": "tickets_closed",
        "title": "Tickets Closed",
        "type": "stat",
        "query": {
          "kind": "metric_sum",
          "platform": "support",
          "artifact_type": "ticket",
          "metric": "closed"
        }
      },
      {
        "id": "closed_by_channel",
        "title": "Closed by Channel",
        "type": "bar",
        "query": {
          "kind": "metric_sum_by_payload",
          "platform": "support",
          "artifact_type": "ticket",
          "metric": "closed",
          "group_by": "channel"
        }
      }
    ]
  },
  "artifacts": [
    {
      "platform": "support",
      "artifact_type": "ticket",
      "external_id": "ticket-1001",
      "title": "Refund request resolved",
      "created_at": "2026-05-25T10:00:00Z",
      "payload": {
        "channel": "email"
      }
    }
  ],
  "observations": [
    {
      "platform": "support",
      "artifact_type": "ticket",
      "external_id": "ticket-1001",
      "observed_at": "2026-05-25T10:00:02Z",
      "metrics": {
        "closed": 1,
        "response_minutes": 12
      }
    }
  ]
}
```

## Dashboard Query Kinds

- `artifact_counts`: count artifacts by type in the selected time range.
- `metric_sum`: sum a numeric metric in the selected time range.
- `metric_avg`: average a numeric metric in the selected time range.
- `metric_sum_by_payload`: sum a metric grouped by an artifact or observation payload field.
- `latest_metric_leaderboard`: rank artifacts by their latest observed metric.

Rules:

- `metrics` values must be finite numbers.
- `payload` is for dimensions such as `channel`, `tool`, `status`, `campaign`, `client`.
- Agents should push both the spec and the data. The server does not scrape agent-specific business systems.
- `agent_id` is required. `agentId` is accepted as an input alias and normalized to `agent_id`.
- GTM Swarm stores and filters report data by `agent_id`; `agent_key` is display/readability metadata.
- Push a new `dashboard_spec` when the agent changes its report shape; GTM Swarm uses the latest spec for that `workspace + agent_id + platform`.
