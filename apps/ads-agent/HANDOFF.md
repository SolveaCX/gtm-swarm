# GTM Swarm Ads Agent — Consolidated Handoff

## GitHub

- Repository: <https://github.com/SolveaCX/gtm-swarm>
- Migration branch: <https://github.com/SolveaCX/gtm-swarm/tree/feat/google-ads-agent-migration/apps/ads-agent>
- Existing compatibility entry: <https://github.com/SolveaCX/gtm-swarm/tree/main/projects/flatkey/agents/08-ads>

After merge, replace the branch segment with `main`.

## What moved

The formerly separate local Ads Executor, Google Ads reporting pipeline, VOC AI campaign tools, Flatkey playbook, Solvea launch package, and shared Ads Playbook now live under `apps/ads-agent/`. See `MIGRATION_INVENTORY.md` for the exact mapping and exclusions.

## Production truth and current status

- Agent/task/runtime/approval state: Multica/11Agents database.
- Campaign/delivery/spend/platform IDs: Google Ads or Apple Search Ads.
- Code and reviewed artifacts: this repository.
- The repository migration does not prove that any Campaign is live and does not change account delivery.
- Existing machine-local executor remains the active runtime until a separately approved cutover.

## Platform dependencies

- 11Agents continues to own `/api/ads-executor/claim`, `/report`, and `/sync` plus queue/database logic.
- The reviewed request/response and Google Ads entity contract is snapshot in `docs/EXECUTOR_CONTRACT.md`.
- The active cron still points to `~/voc-ads/push_daily_stats.py`; it must be changed only during the approved cutover.
- Do not delete the old local sources or secret files until the new runtime has completed two dry-run cycles and one approved armed cycle with reconciled results.

## Cutover checklist

1. Merge and deploy the repository version.
2. Provision secret files outside Git with owner-only permissions.
3. Install pinned Python dependencies in a dedicated virtual environment.
4. Run unit tests and `py_compile`.
5. Run `executor.py --once` with `ARMED=0` and compare synced counts to the current executor.
6. Confirm unknown Campaign names are reported as unmapped rather than assigned to Solvea.
7. Stop and unload the old `com.11agents.ads-executor` process.
8. Start the new daemon with `ARMED=0`; observe at least two successful cycles.
9. Confirm only one executor is claiming actions.
10. Obtain written approval before setting `ARMED=1`.
11. Keep `ALLOW_ENABLE=0` until a separate launch approval explicitly allows Campaign resume/enable.
12. Record cutover time, operator, config hash, first claimed action ID, and first successful sync.

## Rollback

1. Set `ARMED=0` immediately.
2. Stop the new daemon.
3. Verify no action remains in a claimed-but-unreported state.
4. Restart the old daemon only after confirming it is the sole claimant.
5. Preserve action IDs, timestamps, Google Ads mutation results, and logs for reconciliation.

## Product owners and blockers

- Flatkey: do not scale until first top-up/revenue attribution and activation funnel are trustworthy.
- VOC AI: conversion chain has documented GTM, cross-domain GCLID, and signup-route blockers; repair before interpreting zero conversions.
- Solvea: App campaigns remain gated by runtime/account connection and real-device revenue-event QA.

No product may scale from CTR, CPC, install, or signup volume alone. The primary decision input is verified realized revenue, CAC, ROAS, refund quality, and payback.
