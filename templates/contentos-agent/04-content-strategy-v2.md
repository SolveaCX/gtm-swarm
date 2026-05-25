# ContentOS Agent — Step 4 v2: Content Strategy + Registry-Driven Hydration

> **v2 vs v1 (2026-05-25)**: v1 hardcoded 11 agents in the YAML schema (`01-foundation` ... `11-poster`).
> v2 reads the agent set from <code>agent_definitions WHERE enabled=true</code> (migration 003).
> Adding a new agent (e.g. `12-mcp-registry`, `13-customer-agent`, `14-producthunt`) requires zero prompt edits.
> Aligned with Principle 04: "The swarm adapts to whatever you need to sell."

## Input

You will receive:

1. `project.yaml`
2. `01-market-insight.md`
3. `02-user-insight.md`
4. `03-competitor-analysis.md`
5. **`agent_registry.json`** — the runner injects this; it's the result of
   `SELECT slug, display_name, category, platforms, goal_template, kpi_schema FROM agent_definitions WHERE enabled=true ORDER BY ordering`.
   Treat it as the **complete universe** of agents you may activate. **You may not invent agent slugs that are not in this list.**

## Your Job

Produce TWO outputs in a single response:

### Output A: Content Strategy Brief (~600 words)

```markdown
# Content Strategy — <Product Name>

## North Star Metric
The ONE metric this entire GTM Swarm optimizes for over 6 months.
**Must be revenue-attributable or signup-attributable** (per Principle 04: traffic + revenue is the only goal).
Examples:
- "qualified Reddit-sourced trial signups" (SaaS)
- "Kickstarter pre-orders attributed to KOL drops" (hardware)
- "MCP tool calls from agent registries" (agent-native product)
- "consult-form submissions from local SEO" (service)

## Brand Voice (1-paragraph distillation)
Distill Steps 1-3 into one paragraph. This seeds `engines/<slug>/voice/brand-voice.md`.

## Content Pillars (3-5)
Each pillar = a recurring topic territory.

## Channel Strategy (registry-driven)
For EACH agent in `agent_registry.json`, decide:
- `activate: true | false`
- `activation_reason`: 1-sentence why (especially for `false` — what about THIS product makes that channel a wrong fit?)
- if `activate: true`:
  - `topic_territory`: 3-5 specific topics (NOT generic categories)
  - `weekly_target`: numeric, with unit
  - `measure`: how the KPI is observed (must be observable in `conversion_events`)

> **Hard rule**: you must emit a decision for EVERY agent in the registry, not just the ones you activate. `false` is a valid and important answer.

## Editorial Calendar Pattern
A typical week's output across all active agents. Counts per platform.

## Distribution Sequence
For one canonical topic, walk through the platform-native repurpose chain across the active agents.

## Attribution Plan
For each active agent, name the **tracking handle** it will use (per migration 002 schema):
- `utm_campaign` template, or
- `short_url` prefix (e.g. `sol.cx/r/`), or
- `post_id` reporting (e.g. weekly export from reddit API)

This tells the runner how to populate `tracking_handles` at publish-time.
```

### Output B: Registry Hydration YAML

After the markdown brief, output a YAML block. **Each entry's `agent_slug` MUST exist in `agent_registry.json`**.

```
---AGENT-HYDRATION-START---
hydration_schema_version: 2
hydrated_at: <ISO8601>
agents:
  - agent_slug: "<slug from registry, e.g. '01-foundation'>"
    activate: true | false
    activation_reason: "<1-sentence>"
    goal: "<1-sentence outcome, inheriting brand voice paragraph>"
    weekly_target: <int>
    measure: "<observable metric>"
    topics:
      - "<topic 1>"
      - "<topic 2>"
      - "<topic 3>"
    attribution:
      method: "utm" | "short_url" | "post_id" | "mcp_call"
      handle_template: "<template, e.g. 'utm_campaign=<slug>-{topic_kebab}-{yyyymm}'>"
  - agent_slug: "<next>"
    ...
---AGENT-HYDRATION-END---
```

## Critical Rules

1. **Only activate agents that fit this product.** If `agent_registry.json` has 15 agents and only 4 fit a B2C hardware Kickstarter (e.g. KOL, Video, IG-ads, EDM), set the other 11 to `activate: false` with reasons. **Iron Triangle stays — agents without a complete Builder + Reviewer in the registry CANNOT be activated; emit `activate: false, activation_reason: "no Iron Triangle"`.**
2. **`weekly_target` must be numeric** and **measurable in `conversion_events`** — "more signups" is wrong; "10 trial signups/week, measured via utm_campaign=voc-ai-reddit-{yyyymm}" is right.
3. **Topics must be specific.** Generic categories like "AI trends" fail. Specific: "The #1 complaint pattern across electronics reviews + how to use it for product research."
4. **Goal language must inherit the brand voice paragraph** so when agents run, voice is consistent.
5. **Attribution is mandatory for every activated agent.** No agent ships without a tracking handle plan. If you can't propose one for a channel, set `activate: false, activation_reason: "no attribution path"`.
6. **Distribution Sequence** — name one real topic and walk it across the active agents' platforms showing rethink-per-platform.

## What v2 changes for the runner

After Founder approves this brief, the system will:
1. Parse the `---AGENT-HYDRATION---` block (still YAML)
2. **UPSERT each entry into `workspace_agents` table** (per migration 003) — no more writing to `projects/<slug>/agents/<id>/agent.yaml`
3. Set `workspaces.lifecycle_state = 'built'`
4. Dashboard reads `workspace_agent_deployability` view to surface activatable agents

---

## OUTPUT INSTRUCTION (strict)

You ARE writing the markdown brief AS your direct response. Do NOT say "I wrote ..." — output the full structured brief itself.

Required sections in order:
1. `# Content Strategy — <Product Name>`
2. `## North Star Metric`
3. `## Brand Voice (1-paragraph)`
4. `## Content Pillars (3-5)`
5. `## Channel Strategy (decisions for ALL agents in registry, not just activated ones)`
6. `## Editorial Calendar Pattern`
7. `## Distribution Sequence`
8. `## Attribution Plan`
9. The `---AGENT-HYDRATION-START---` YAML block at the very END
10. The `---AGENT-HYDRATION-END---` marker

Target 3000-5000 words. The YAML block MUST be valid YAML that parses cleanly. Every agent in `agent_registry.json` MUST appear as an entry, even if `activate: false`. No preamble. Start with the H1.

---

## Migration plan (v1 → v2)

- Keep v1 (`04-content-strategy.md`) deployed for the 6 existing products(no breaking change)
- New products onboard via v2 directly
- After migration 003 lands and the runner gains the `agent_registry.json` injection, switch all products to v2
- v1 retired once all 6 existing products have been re-hydrated under v2
