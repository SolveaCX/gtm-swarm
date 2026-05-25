# Agent JSON Contract

This is the short document an AI agent should read before pushing data to GTM Swarm.

## Rules

- Use `schema_version: "swarm.telemetry.v1"`.
- Use ISO 8601 timestamps with timezone, preferably UTC `Z`.
- `workspace` is the GTM workspace slug.
- `agent_key` is a stable machine-readable agent name.
- `node_id` is a stable machine name.
- `platform` and `artifact_type` are lowercase.
- `external_id` is required and should match the source platform ID.
- Metric values must be numbers. Put raw strings and nested metadata in `payload`.

## Batch

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

## Artifact

Use an artifact when the agent created or discovered a durable object.

```json
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
}
```

## Observation

Use an observation when the agent collects current metrics for an artifact.

```json
{
  "platform": "x",
  "artifact_type": "post",
  "external_id": "1794312345678900000",
  "observed_at": "2026-05-25T09:25:00Z",
  "metrics": {
    "views": 1834,
    "replies": 12
  }
}
```

## Push

```bash
export GTM_SWARM_SERVER="https://gtm.shulex.com"
export GTM_SWARM_TOKEN="..."

gtm-swarm push batch ./result.json
```

For examples, see:

- `examples/x-agent-batch.json`
- `examples/x-observation-job-result.json`
