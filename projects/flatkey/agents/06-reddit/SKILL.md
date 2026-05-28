# Agent 06-reddit — SKILL (Builder owns this file)

**Builder:** Wayne
**Reviewer:** Ivy Chen
**Default product:** voc-ai
**Status:** pilot

## What this agent does
TODO — Builder fills in. What is the job, what does success look like, how often does it run.

## Inputs
- Topic / brief (from `memory/trending.md` or manual)
- `engines/voc-ai/` Skill Graph (Ronin pattern)
- `memory/playbook.md` cross-agent lessons
- `agents/06-reddit/playbook.md` agent-specific lessons
- `agents/06-reddit/anti-patterns.md` rejected drafts

## Tools / platform connectors
TODO — list `platforms/*` modules.

## Execution recipe
1. Read `engines/voc-ai/CLAUDE.md` for full skill graph
2. Read `agents/06-reddit/playbook.md` + `anti-patterns.md`
3. Produce native draft (NOT reformat — rethink per Principle 5)
4. Write to `agents/06-reddit/content-bank/draft/<ts>-<slug>.md` with frontmatter (product, topic, hook_type, source_url)
5. Symlink into `reviews/Ivy Chen/` for queue

## Definition of Stable · Good · Long-Running (Principle 2)
- **Stable**: TODO — what makes runner not break (rate-limit, retry, fallback)
- **Good**: TODO — output quality bar from Reviewer
- **Long-running**: TODO — what stays consistent over months (voice, frequency, KPI direction)
## Daily Telemetry Collection

When assigned a GTM Swarm `collect_daily_telemetry` task:

1. Read `workspace`, `agent_id`, `agent_key`, `platform`, `report_type`, `day`, `from`, `to`, `job_id`, and `daily_run_id`.
2. Collect metrics only for artifacts owned by this agent and platform.
3. Return observations using the `swarm.telemetry.v1` contract.
4. Complete the Swarm job with a success summary.
5. If collection cannot be completed, complete the job as failed with a specific reason.

