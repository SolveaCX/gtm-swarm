# GTM Swarm CLI

Local CLI for GTM Swarm agent nodes.

## Setup

```bash
export GTM_SWARM_SERVER="https://gtm.shulex.com"
export GTM_SWARM_TOKEN="<workspace token supplied through your secret manager>"
export GTM_SWARM_WORKSPACE="pricing-analyse"  # Flatkey's production workspace slug
export GTM_SWARM_AGENT_ID="<stable agent id>"
export GTM_SWARM_AGENT="x-growth-agent"
export GTM_SWARM_NODE="mac-mini-01"
```

Ask a GTM Swarm administrator to retrieve the workspace token through the protected
token-administration endpoint, whose administrator access is controlled by
`GTM_API_TOKEN`. The administrator must deliver it through the approved secret
manager; public project responses, project cards, and dashboards are not token
sources. `GTM_API_TOKEN` is only for token administration and must not be configured
as `GTM_SWARM_TOKEN` in an agent runtime.

The administrator endpoint is `GET /api/workspaces/{slug}/swarm-token`; its
`POST` form rotates the token. Both operations require the administrator bearer,
return `Cache-Control: private, no-store`, and must never be called from an agent runtime.

`GTM_SWARM_AGENT_ID` is required. It must be the stable agent/runtime id used to isolate telemetry and dashboard specs. `GTM_SWARM_AGENT` is a readable agent key.

## Validate JSON

```bash
node bin/gtm-swarm.js validate examples/x-agent-batch.json
```

## Push

```bash
node bin/gtm-swarm.js push batch examples/x-agent-batch.json

node bin/gtm-swarm.js push artifact \
  --agent-id agent-runtime-123 \
  --type post \
  --platform x \
  --external-id 1794312345678900000 \
  --url https://x.com/acme/status/1794312345678900000 \
  --body "We shipped today."

node bin/gtm-swarm.js push observation \
  --agent-id agent-runtime-123 \
  --type post \
  --platform x \
  --external-id 1794312345678900000 \
  --metric views=1901 \
  --metric replies=13
```

## Run Node Worker

```bash
node bin/gtm-swarm.js node run --handler ./collect-x.js --once
```

Handler contract:

```js
export async function handleJob(job) {
  return {
    status: 'completed',
    summary: 'Collected observations',
    batch: {
      schema_version: 'swarm.telemetry.v1',
      workspace: job.workspace,
      agent_id: job.agent_id || process.env.GTM_SWARM_AGENT_ID,
      agent_key: job.agent_key,
      node_id: process.env.GTM_SWARM_NODE || 'local',
      sent_at: new Date().toISOString(),
      artifacts: [],
      observations: []
    }
  }
}
```

AI agents should read `specs/agent-json-contract.md` before generating payloads.
