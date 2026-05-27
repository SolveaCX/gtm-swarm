# GTM Runtime Fleet Design

> Spec v1.0 · 2026-05-27

## Purpose

New GTM projects should open with a useful Multica workspace instead of an empty workspace that requires manual agent and runtime wiring.

The constraint is that Multica runtimes are real local listeners. They cannot be invented by a project template because the machine must run a command to establish the channel. GTM Swarm therefore owns a runtime fleet registry: a source of truth for which machines exist, what each machine can do, and which Multica workspaces those machines should listen to.

The goal is:

```
project created
  -> Multica workspace created and bound
  -> agent pack installed
  -> GTM chooses required machine listeners
  -> machine registers runtime with Multica
  -> agents bind to returned runtime_id
```

## Non-Goals

The first version does not remotely control user machines, install secrets, or SSH into hosts. It produces explicit registration plans and local commands. A human or local automation runs those commands on the target machine.

The first version also does not require all agents to be ready before a workspace is usable. Agents with missing runtime stay visible in Multica as `needs_runtime`.

## Core Concepts

### Runtime Machine

A runtime machine is a known host that can run one or more local automation stacks.

Example capabilities:

- `shell`
- `browser_cdp`
- `launchd`
- `x_automation`
- `reddit_automation`
- `seo_publish`
- `image_generation`
- `review_analysis`

Each machine declares required paths, required environment variables, and the command it uses to start a Multica listener.

### Runtime Profile

A runtime profile is a reusable requirement class. It says what a class of agent needs, not which concrete runtime instance it will use.

Examples:

- `local-x-runtime`
- `local-reddit-runtime`
- `gtm-seo-runtime`
- `gtm-research-runtime`
- `video-publisher-runtime`

### Runtime Instance

A runtime instance is the concrete Multica runtime created when a local listener registers. It has a real `runtime_id` and may go online or offline.

Templates should never hardcode `runtime_id`. They reference runtime profiles. Runtime IDs are deployment state.

### Agent Template

An agent template defines the Multica agent to create for a workspace:

- name
- description
- visibility: always `workspace`
- model
- instructions
- skills
- environment requirements
- runtime requirement

### Registration Plan

A registration plan is GTM's answer to: "Which machine should listen to this Multica workspace for these agents?"

It contains target workspace, machine, profiles, required env, missing prerequisites, and the local command to run.

## Proposed File Structure

Start with file-backed registries so this can ship without a database migration:

```text
config/runtime-machines.yaml
config/runtime-profiles.yaml
config/agent-templates.yaml
server/runtime-fleet.js
server/runtime-fleet.test.js
```

The config files become the human-editable GTM operations source of truth. The server module validates and resolves them.

## Runtime Machine Schema

```yaml
machines:
  boyuan-mac-mini:
    owner: boyuan
    role: local-automation
    labels:
      - trusted-local
      - macos
    capabilities:
      - shell
      - browser_cdp
      - launchd
      - x_automation
      - reddit_automation
    paths:
      x_agent: /Users/siliconno3/x_agent
      reddit_agent: /Users/boyuangao/gtm/reddit-agent
    env_required:
      - ANTHROPIC_API_KEY
      - TELEGRAM_BOT_TOKEN
      - TELEGRAM_CHAT_ID
    listener:
      command_template: "gtm runtime listen --machine boyuan-mac-mini --workspace {{workspace}} --profiles {{profiles}}"
```

The path values are expected paths, not secrets. Secret values stay on the machine or in Multica's runtime secret store.

## Runtime Profile Schema

```yaml
profiles:
  local-x-runtime:
    capabilities:
      - shell
      - browser_cdp
      - x_automation
    required_paths:
      - x_agent
    env_required:
      - ANTHROPIC_API_KEY
      - TELEGRAM_BOT_TOKEN
      - TELEGRAM_CHAT_ID
    preferred_machines:
      - boyuan-mac-mini

  local-reddit-runtime:
    capabilities:
      - shell
      - browser_cdp
      - reddit_automation
      - launchd
    required_paths:
      - reddit_agent
    env_required:
      - ANTHROPIC_API_KEY
    preferred_machines:
      - boyuan-mac-mini
```

Profiles should stay generic. Product-specific settings belong in project config, agent runtime config, or skill instructions.

## Agent Template Schema

```yaml
agents:
  x-growth-agent:
    name: X Growth Agent
    description: Operates X engage, quote scout, Telegram approval, and analytics feedback loops.
    visibility: workspace
    model: gpt-5.5
    runtime_profile: local-x-runtime
    skills:
      - hunter-x-agent
      - voc-ai-x-agent
    status_without_runtime: needs_runtime
    environment:
      required:
        - ANTHROPIC_API_KEY
        - TELEGRAM_BOT_TOKEN
        - TELEGRAM_CHAT_ID

  reddit-growth-agent:
    name: Reddit Growth Agent
    description: Operates Reddit account warmup, karma, comment generation, scheduling, and health checks.
    visibility: workspace
    model: gpt-5.5
    runtime_profile: local-reddit-runtime
    skills:
      - reddit-growth-operator
    status_without_runtime: needs_runtime
```

The `skills` list names workspace-installed skills. If a current stack is not yet packaged as a skill, the agent template should reference a wrapper skill to create before enabling that agent as ready.

## Project Creation Flow

1. Create or find the Multica workspace.
2. Bind `workspaces.multica_workspace_slug` immediately.
3. Install the standard GTM agent pack into the workspace.
4. For each agent template, resolve `runtime_profile` against the fleet registry.
5. If an online runtime instance is already registered for the workspace and profile, bind the agent to its `runtime_id`.
6. If no runtime instance exists, create the agent with status `needs_runtime`.
7. Generate a setup issue in Multica with the registration plan.
8. When the machine listener registers, update matching agents with `runtime_id` and status `idle` or `needs_env`.

## Registration Plan Example

````md
## Runtime Registration Needed

Workspace: voc-ai

Machine: boyuan-mac-mini

Profiles:
- local-x-runtime
- local-reddit-runtime

Run on the machine:

```bash
gtm runtime listen --machine boyuan-mac-mini --workspace voc-ai --profiles local-x-runtime,local-reddit-runtime
```

Agents waiting:
- X Growth Agent
- Reddit Growth Agent

Preflight checks:
- x_agent path: expected `/Users/siliconno3/x_agent`
- reddit_agent path: expected `/Users/boyuangao/gtm/reddit-agent`
- required env: `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
````

## Runtime Listener Flow

The local command should:

1. Read the machine profile from GTM Swarm.
2. Run local preflight checks for declared paths and env vars.
3. Register or update a runtime instance in Multica for the target workspace and profile.
4. Start listening for queued runtime tasks.
5. Report health and capability metadata back to Multica.
6. Return the runtime IDs so GTM can bind waiting agents.

The listener should refuse to start if its machine key is unknown or if requested profiles require capabilities the machine does not declare.

## Agent States

Use explicit states so workspaces are understandable:

- `idle`: agent is installed, runtime bound, and no task is running.
- `needs_runtime`: agent is installed but no matching runtime listener has registered.
- `needs_env`: runtime exists but preflight reports missing required environment.
- `blocked_config`: runtime exists, but path/config validation fails.
- `running`: agent has an active runtime task.
- `disabled`: installed but intentionally not active for this project.

## Selection Rules

Runtime selection should be deterministic before using AI:

1. Prefer a runtime instance already registered to the same workspace and profile.
2. Prefer machines listed in the profile's `preferred_machines`.
3. Require all profile capabilities to be present on the machine.
4. Prefer machines with all required paths present in the last known preflight.
5. If multiple machines tie, use config order and emit the reason.

AI can help choose which agent pack to install or whether a channel is relevant. It should not override hard capability checks.

## Standard First Agent Pack

The initial pack should include:

- Agent-First GTM Strategist
- SEO Blog Agent
- X Growth Agent
- Reddit Growth Agent
- VOC Research Agent

Video publishing can be added as a profile and template once the TikTok/video stack has a stable local runtime and skill wrapper.

## Failure Handling

Project creation should never fail just because a local runtime is offline. The workspace should still be created, bound, and populated with agents.

Failures become visible setup work:

- No matching machine: create setup issue tagged `runtime-missing`.
- Machine exists but not registered: create registration plan.
- Runtime registered but env missing: mark agent `needs_env` and list missing env names.
- Runtime registered but local path missing: mark agent `blocked_config`.

## Security

GTM Swarm stores requirements and path expectations, not secret values.

Runtime listener commands must run locally on the machine that owns the credentials. The listener may report whether an env var exists, but must not echo values.

The first version should not implement remote execution. If remote control is needed later, it should be designed as a separate trust and permissions layer.

## Testing Strategy

Unit tests should cover:

- Machine/profile matching.
- Missing capability rejection.
- Preferred machine ordering.
- Registration plan rendering.
- Agent status assignment when runtime exists, runtime is missing, or env preflight fails.

Integration tests should mock Multica DB helpers and verify that project creation creates agents even when no runtime is available.

## Open Questions

1. Where should Multica runtime instances be stored and queried from: existing runtime tables, agent rows, or a new GTM-side cache?
2. Should runtime listeners register one runtime per profile or one multi-profile runtime per machine/workspace?
3. Should setup issues be one per workspace or one per missing machine?
4. What is the exact Multica CLI/API command for runtime listener registration?

## Recommendation

Implement the first version as a static Runtime Fleet registry plus registration plan generator. This gives new projects a populated Multica workspace immediately while respecting the fact that local runtimes must be registered from the machine that will execute the work.
