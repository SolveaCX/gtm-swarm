# GTM Swarm x Multica Operating Model

> Spec v1.0 · 2026-05-26

## Purpose

GTM Swarm is the growth execution and learning system for multiple products. Multica is the operational control plane for agent work, human review, task assignment, approval, and audit history.

The goal is not only to produce more GTM output. The goal is to make the GTM system compound:

```
project context -> agents execute -> dashboard records results
  -> AI and human reviewers identify learnings
  -> learnings become tasks, experiments, memory updates, or SOP changes
  -> future agent execution improves
```

This document standardizes the terms, ownership boundaries, issue types, and review rules so every team member can explain and operate the system consistently.

## System Boundary

### Multica Owns Operations

Multica is the source of truth for day-to-day work coordination.

It owns:

- Workspace-level agent instances.
- Runtime bindings for executable agents.
- Issues, tasks, comments, status, assignees, and priorities.
- Human approval flow.
- Agent execution queue.
- Audit trail for why a task or SOP change happened.

Multica should be treated as the GTM organization's decision ledger. If a decision changes agent behavior or creates GTM work, it should be represented as a Multica issue or comment.

### GTM Swarm Owns Knowledge And Integration

GTM Swarm is the source of truth for GTM knowledge assets, project context, metrics integration, and agent templates.

It owns:

- Global GTM agent skill templates.
- Project-specific SOP and memory.
- Product/project configuration.
- Dashboard metrics and telemetry.
- AI review digest generation.
- Approved knowledge updates after Multica review.
- Connectors that push tasks and read results from Multica.

GTM Swarm should not become a second task system. It should generate proposals, sync data, and update knowledge assets after Multica approval.

## Core Concepts

### Product Project

A project is one product's GTM context, for example `voc-ai`, `solvea`, or `flatkey`.

Each project has its own:

- Positioning.
- ICP and audience notes.
- Competitors.
- Channel learnings.
- Winning hooks.
- Objections.
- Project-level SOP overrides.
- Dashboard metrics.

The same base agent template can serve multiple projects because project context is injected at runtime.

### Global Agent Skill Template

A global agent skill template defines the reusable operating method for an agent type.

Examples:

- Reddit agent template.
- X agent template.
- Blog/SEO agent template.
- Research/VOC agent template.
- KOL/partnership agent template.
- Landing/CRO agent template.
- AI strategy reviewer template.

Global templates contain the broadly reusable method: channel rules, workflow, quality bar, checklist, formatting expectations, and anti-patterns.

### Project SOP And Memory

Project SOP and memory are product-specific layers applied on top of global templates.

They contain:

- Product-specific audience details.
- Product-specific claims and forbidden claims.
- Channel-specific project learnings.
- Recent winning hooks.
- Known objections.
- Competitor notes.
- Examples that worked or failed.

Default execution model:

```
agent behavior = global agent skill template + project SOP + project memory + current Multica issue context
```

### Runtime-Backed Multica Agent

A Multica agent is a workspace-level executable instance. It may bind to a runtime through `runtime_id`.

The practical rule:

- Runtime = execution capability.
- Multica agent = workspace-specific identity assigned to work.
- GTM Swarm = knowledge and integration layer that feeds context to that work.

Agents created for GTM work should live in Multica. GTM Swarm should store references and context, not duplicate Multica's agent registry.

## Reviewer Model

The system uses both human reviewers and AI reviewers.

### Human Reviewer

Human reviewers own judgment.

They decide:

- Which insights are strategically important.
- Which patterns are real instead of noise.
- Which SOP changes are worth adopting.
- Which tasks deserve priority.
- Which outputs hurt positioning, brand, or trust.
- When a project-specific learning should be promoted into a global template.

### AI Strategy Reviewer

The AI strategy reviewer owns attention coverage.

It should automatically read:

- Dashboard metrics.
- Agent output.
- Multica issues and comments.
- Review outcomes.
- Telemetry and artifacts.

It should generate candidate findings and proposals:

- Repeated quality problems.
- Winning hooks or angles.
- Channel-specific performance changes.
- Audience objections.
- Agent execution failures.
- Data anomalies.
- Suggested experiments.
- Suggested SOP or memory updates.

The AI reviewer can propose changes, but it should not directly modify global templates. Important knowledge changes require human review.

## Standard Issue Types

All GTM work and learning changes should fit one of four Multica issue types.

### 1. Execution Task

An execution task asks one agent to do one concrete piece of GTM work.

Examples:

- Write a Reddit post from an approved angle.
- Expand a high-performing X thread into a blog post.
- Generate landing page copy for one persona.
- Research comments under a competitor launch.

Execution tasks may be created automatically when the risk is low and the action is reversible.

### 2. Experiment Task

An experiment task asks one or more agents to test a hypothesis and report results.

Examples:

- Test pain-first hooks against result-first hooks on X and LinkedIn.
- Try three Reddit post formats across similar subreddits.
- Compare founder POV versus user story copy.

Experiment tasks must define:

- Hypothesis.
- Agents/channels involved.
- Variants.
- Success metric.
- Measurement window.
- Expected follow-up.

Most experiments should require human approval before execution because they consume attention and can affect external channels.

### 3. Memory Update

A memory update changes project-specific knowledge without changing the general SOP.

Examples:

- Add a new audience objection.
- Record a winning hook pattern for one product.
- Add a competitor claim to avoid.
- Save a customer quote as supporting evidence.

Memory updates can be proposed by AI or humans. Whether they can land automatically is a product policy choice, but the default should be human approval for anything that affects messaging or positioning.

### 4. SOP Change

An SOP change modifies project SOP or a global agent skill template.

Examples:

- Change the Reddit opening rule for one project.
- Add a new checklist item to the Blog agent.
- Promote a project learning into the global X agent template.
- Update the AI reviewer rubric.

SOP changes should always be reviewed by a human before they land. Global skill template changes must be human approved.

## Proposal Schema

AI-generated and human-generated proposals should use a consistent structure in Multica issue descriptions or structured metadata.

```yaml
type: sop_change # execution_task | experiment_task | memory_update | sop_change
project: voc-ai
target_scope: project # project | global
target_agent_type: reddit
target_file: projects/voc-ai/sop/reddit.md
title: "Prefer pain-first hooks for Reddit posts"
summary: "Pain-first openings produced stronger comment depth over the last 3 days."
evidence:
  - kind: metric
    reference: "reddit comment depth +42% vs feature-first posts"
  - kind: artifact
    reference: "multica://issue/<id>"
  - kind: reviewer_note
    reference: "Human reviewer confirmed this matches recent qualitative feedback."
risk: medium # low | medium | high
confidence: medium # low | medium | high
requires_human_approval: true
expected_effect: "Improve Reddit native fit and reply rate."
rollback_plan: "Remove the project SOP override if the next 5 posts underperform."
```

This schema is intentionally simple. The important part is that every change has a type, target, evidence, risk, approval policy, and rollback path.

## Approval Rules

The default permissions are:

| Change object | AI can propose | AI can execute automatically | Default approval |
|---|---:|---:|---|
| Execution task | Yes | Yes, when low risk | Optional human review |
| Experiment task | Yes | Usually no | Human approval recommended |
| Project memory | Yes | Configurable | Human approval by default |
| Project SOP | Yes | No | Human approval required |
| Global skill template | Yes | No | Human approval required |

The reason for this split is simple: task execution is recoverable, but SOP and skill changes compound into future behavior. Anything that changes future behavior needs a stronger review gate.

## Daily Review Loop

The daily operating rhythm should be:

```
1. Agents execute assigned Multica tasks.
2. GTM Swarm collects artifacts and metrics.
3. Dashboard summarizes performance.
4. AI strategy reviewer generates a daily review digest.
5. Human reviewer reads the digest and dashboard.
6. Reviewer approves, rejects, or edits proposals.
7. Approved proposals become execution tasks, experiments, memory updates, or SOP changes.
8. Approved knowledge changes update GTM Swarm knowledge assets.
9. Future agent runs load the updated knowledge.
```

The daily review digest should include:

- What changed in metrics.
- Which outputs performed unusually well or poorly.
- Which agents are stuck or underperforming.
- Which repeated comments or review failures indicate a process issue.
- Which project memories should be added.
- Which SOP changes should be considered.
- Which tasks or experiments should run next.

## SOP Change Lifecycle

SOP changes should follow this lifecycle:

```
signal detected
  -> proposal created in Multica
  -> human reviewer approves, rejects, or edits
  -> SOP maintainer agent drafts the patch
  -> human final review
  -> patch lands in GTM Swarm knowledge assets
  -> change is referenced in the Multica issue
  -> future runs load the updated SOP
```

The proposal and final patch should remain linked. A reviewer should be able to answer:

- What changed?
- Why did it change?
- What evidence supported it?
- Who approved it?
- Which project or global template was affected?
- How do we roll it back?

## Global Template Promotion Rule

Most learnings should start as project memory or project SOP.

A project learning should only be promoted to a global agent skill template when at least one of the following is true:

- The same learning appears across multiple products.
- The learning is clearly channel-native and not product-specific.
- The learning fixes a recurring quality issue in the base agent behavior.
- A human reviewer judges that all products should inherit it.

This prevents one product's temporary data from contaminating all products.

## Recommended Initial Agent Set

Start with a small, stable set of reusable GTM agent types:

- AI strategy reviewer.
- Research/VOC agent.
- Positioning agent.
- Reddit agent.
- X agent.
- Blog/SEO agent.
- Newsletter agent.
- Landing/CRO agent.

Additional agents should be added only when there is a repeated workflow that does not fit the existing roles.

## Operating Principles

1. Multica is the control plane; GTM Swarm is the knowledge and metrics layer.
2. Every meaningful decision should leave an audit trail in Multica.
3. AI can propose frequently, but humans approve behavior changes.
4. Project learnings should land locally before becoming global.
5. Execution tasks can be automated more aggressively than SOP changes.
6. A proposal without evidence should not change SOP.
7. A global skill template should stay small, reusable, and product-agnostic.
8. Project memory should stay specific, current, and easy for agents to load.
9. Experiments must define success metrics before execution.
10. The system should improve future runs, not just complete today's tasks.

## Open Implementation Notes

The current code already treats Multica agents as workspace-level objects and checks for `runtime_id` before dispatching some work. The next implementation step should standardize runtime-backed agent creation and proposal handling around the issue types above.

No implementation is specified in this document. It defines the operating model and vocabulary that implementation should follow.
