# Daily Telemetry Dispatch Design

**Date:** 2026-05-27
**Status:** Approved for planning

## Goal

Make GTM Swarm the single daily coordinator for agent data statistics. At a fixed time each day, Swarm creates one telemetry collection task for each enabled agent target and actively dispatches that task to the matching Multica agent node. Agents run their own channel-specific statistics workflow and return data through the existing Swarm telemetry contract.

This gives all agents a consistent reporting rhythm while preserving agent-specific knowledge about how to collect metrics for X, Reddit, blog, MCP, or other channels.

## Non-Goals

- Do not put channel-specific scraping or analytics logic into the GTM Swarm server.
- Do not make each agent decide its own daily schedule.
- Do not replace the existing `swarm_jobs`, `swarm_daily_runs`, or telemetry ingestion model.
- Do not require CLI polling as the primary path for daily reporting.
- Do not block job creation when Multica dispatch is unavailable.

## Recommended Approach

Use active Multica dispatch as the primary integration path.

GTM Swarm already has the main pieces:

- `server/cron.js` schedules `runDailySwarmCollections()`.
- `createDailyRuns()` creates daily run records and `collect_daily_telemetry` jobs.
- `dispatchDailyRunToMultica()` can create a Multica issue and dispatch a task to an agent runtime.
- `swarm_daily_runs` tracks queued, leased, completed, failed, and missing states.
- `/api/swarm/jobs/:id/complete` ingests returned batches and marks runs completed.

The design strengthens that path and makes agent responsibilities explicit.

## Architecture

```text
GTM Swarm cron
  -> createDailyRuns(day)
  -> ensure/list enabled swarm_daily_targets
  -> create swarm_daily_runs row
  -> create collect_daily_telemetry swarm_jobs row
  -> dispatchDailyRunToMultica()
  -> Multica issue + agent task
  -> agent reads its own SKILL.md telemetry instructions
  -> agent collects stats
  -> agent completes Swarm job with swarm.telemetry.v1 batch
  -> Swarm marks job and daily run completed
  -> report/dashboard renders current state
```

The server owns cadence, task identity, and completion tracking. The agent owns metric collection and platform-specific interpretation.

## Scheduling

The daily dispatch schedule remains centralized in GTM Swarm:

- `GTM_SWARM_DAILY_CRON` controls when daily telemetry jobs are created.
- `GTM_SWARM_MISSING_CRON` controls when unfinished runs are marked missing.
- The default collection day is `previousUtcDay()`.

If a business timezone is required later, add an explicit timezone/day-boundary setting rather than duplicating schedules inside agent definitions.

## Daily Targets

Each enabled `swarm_daily_targets` row represents one recurring reporting responsibility:

- workspace
- agent key
- platform
- report type
- optional Multica agent name
- enabled flag

Dispatch should resolve the assignee in this order:

1. `multica_agent_name`
2. exact `agent_key`
3. humanized `agent_key` with hyphens replaced by spaces

If no Multica runtime is found, Swarm still keeps the daily run and job. The run should record the dispatch problem so operators can see that the task was created but not delivered.

## Task Payload

Each dispatched Multica task should contain enough information for the agent to act without guessing:

- workspace slug
- agent key
- platform
- report type
- day
- `from` and `to` ISO timestamps
- Swarm job id
- daily run id
- expected output schema: `swarm.telemetry.v1`
- completion endpoint
- required metrics when known
- clear failure behavior

The issue description should be operational, not generic. The agent should be able to read it and immediately know what to collect and where to return the result.

## Agent Skill Contract

Each agent should define a daily telemetry section in its own `SKILL.md`.

Recommended section:

```md
## Daily Telemetry Collection

When assigned a GTM Swarm `collect_daily_telemetry` task:

1. Read `workspace`, `agent_id`, `agent_key`, `platform`, `report_type`, `day`, `from`, `to`, `job_id`, and `daily_run_id`.
2. Collect metrics only for artifacts owned by this agent and platform.
3. Return observations using the `swarm.telemetry.v1` contract.
4. Complete the Swarm job with a success summary.
5. If collection cannot be completed, complete the job as failed with a specific reason.
```

Agent-specific sections should describe channel metrics and data sources. For example, an X agent may collect views, replies, likes, and reposts. A blog agent may collect pageviews, clicks, signups, or conversions. The shared schema stays centralized in `gtm-swarm-cli/specs/agent-json-contract.md`.

## Data Flow

1. Cron starts the daily run for a target.
2. Swarm creates or reuses the `swarm_daily_runs` row for `(target_id, day)`.
3. Swarm creates a `swarm_jobs` row with kind `collect_daily_telemetry`.
4. Swarm dispatches a Multica issue and task to the resolved agent runtime.
5. The agent follows its own telemetry skill instructions.
6. The agent posts a job completion payload containing a telemetry batch.
7. Swarm ingests artifacts/observations and marks the job completed.
8. Swarm marks the daily run completed.
9. The dashboard/report API shows completed, failed, missing, and dispatch-problem states.

## Error Handling

- Missing database configuration: cron/API should log or return the existing `GTM_DATABASE required` error.
- Invalid cron expression: server logs the invalid schedule and does not register that schedule.
- Existing daily run: job creation is idempotent by `(target_id, day)`.
- Multica unavailable: daily run and job remain created; dispatch error is recorded for visibility.
- Agent runtime missing: run records that dispatch was not delivered.
- Agent collection failure: agent completes the job with `status: failed`; Swarm marks the job and daily run failed.
- Agent silence: missing cron marks queued or leased daily runs as `missing`.

## Reporting and Visibility

Operators need to see:

- which daily targets exist;
- which runs were created for the day;
- whether dispatch succeeded;
- which Multica issue/task was created;
- whether the agent completed, failed, or missed the run;
- any failure or missing reason.

The existing `swarm_daily_runs` table already carries status and `missing_reason`. Implementation can either continue storing dispatch metadata there or add structured metadata later if the status view becomes too hard to query.

## Testing

Unit tests should cover:

- day window construction;
- daily job target payload shape;
- daily run idempotency;
- Multica dispatch success path;
- Multica dispatch unavailable/runtime missing path;
- job completion updates daily run status;
- missing cron marks stale queued/leased runs.

Integration-level verification should exercise:

- `runDailySwarmCollections(day)` creates jobs for enabled targets;
- dispatch creates the expected Multica issue/task when Multica is configured;
- completing a dispatched job ingests telemetry and marks the daily run completed.

## Open Implementation Notes

- Keep CLI polling as a fallback path, not the primary daily-reporting path.
- Avoid duplicating scheduling instructions in agent skill files.
- Prefer improving the existing dispatch description before adding new tables.
- If dispatch metadata becomes first-class, use structured JSON rather than appending opaque strings to `missing_reason`.
