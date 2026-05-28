# GTM Swarm CLI

Local CLI for GTM Swarm agent nodes.

## Setup

```bash
export GTM_SWARM_SERVER="https://gtm.shulex.com"
export GTM_SWARM_TOKEN="<workspace swarm_token>"
export GTM_SWARM_WORKSPACE="flatkey"
export GTM_SWARM_AGENT_ID="<stable agent id>"
export GTM_SWARM_AGENT="x-growth-agent"
export GTM_SWARM_NODE="mac-mini-01"
```

Copy the workspace token from the GTM Swarm project card.
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
