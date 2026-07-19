# GTM Swarm Ads Agent — Consolidated Handoff

Last updated: 2026-07-19

## Canonical code location

- Repository: <https://github.com/SolveaCX/gtm-swarm>
- Module: <https://github.com/SolveaCX/gtm-swarm/tree/feat/google-ads-agent-migration/apps/ads-agent>
- This handoff: <https://github.com/SolveaCX/gtm-swarm/blob/feat/google-ads-agent-migration/apps/ads-agent/HANDOFF.md>
- Migration branch: `feat/google-ads-agent-migration`
- Migration implementation commit: `e3fe364`
- Review / PR entry: <https://github.com/SolveaCX/gtm-swarm/pull/new/feat/google-ads-agent-migration>
- Existing compatibility entry: <https://github.com/SolveaCX/gtm-swarm/tree/main/projects/flatkey/agents/08-ads>

After merge, use `main/apps/ads-agent/` as the canonical path. Do not maintain a second fork of the executor in a product directory.

## What is consolidated

The formerly separate machine-local Google Ads assets now live under `apps/ads-agent/`:

- Shared runtime: approved-action Google Ads executor and Google Ads-to-11Agents telemetry pipeline.
- Flatkey: paid-acquisition playbook and recovered operating status.
- VOC AI: Google Ads Editor CSVs, guarded one-time scripts, status, plan, and conversion-tracking incident notes.
- Solvea: App paid-growth skill, Apple Search Ads Wave 1 package, Google/Meta artifacts, measurement contract, dashboards, and creatives.
- Shared governance: paid-ads playbook, example configuration, launchd template, runtime dependencies, migration inventory, and rollback procedure.
- 11Agents integration: reviewed `/api/ads-executor/claim`, `/report`, and `/sync` contract snapshot. The platform queue and database implementation remains owned by 11Agents and is not duplicated here.

See `MIGRATION_INVENTORY.md` for the exact source-to-destination mapping, exclusions, and normalization decisions.

## Safety controls

- `ARMED=0` is the default and prevents live mutations.
- `ALLOW_ENABLE=0` independently blocks Campaign resume/enable.
- Migrated VOC mutation scripts require `ADS_MUTATION_APPROVED=1` for every write invocation.
- Unknown Campaign prefixes are skipped and reported; they are never silently classified as Solvea.
- Credentials, tokens, `.env` files, logs, caches, runtime state, and local database state must never enter Git.
- Two armed executors must never claim from the same action queue.

## Validation completed for `e3fe364`

- Three Python unit tests passed.
- Runtime and migrated VOC Python scripts passed compilation checks.
- Eight Google Ads Editor CSV structural checks passed.
- Responsive Search Ad headline and description lengths passed validation.
- All migrated VOC import Campaigns are `Paused`.
- LaunchAgent plist passed validation.
- Migrated binary creative assets matched their sources.
- Executor contract snapshot matched the source contract.
- Sensitive-information scan returned no matches.

These checks validate the repository migration. They do not prove that a Campaign is live, that production has switched to this code, or that revenue attribution is correct.

## Production truth and current status

- Agent/task/runtime/approval state: Multica/11Agents database.
- Campaign/delivery/spend/platform IDs: Google Ads or Apple Search Ads.
- Reviewed code and artifacts: this repository.
- Code migration: complete and pushed on `feat/google-ads-agent-migration`.
- Production cutover: **not performed**.
- Active executor path remains `/Users/a1111/ads-executor/executor.py`.
- Active cron still invokes `/Users/a1111/voc-ads/push_daily_stats.py`.
- The repository migration does not mutate Google Ads or change account delivery.

Do not delete the old sources or secret files until the repository runtime has completed two dry-run cycles and one separately approved armed cycle with reconciled results.

## Known recovery limitation

Historical notes referenced a larger `~/google-ads/` sprint workspace and additional Flatkey scripts/dashboard assets. At migration time, that workspace contained only `config/.env`; the executable assets were not present. The migration therefore includes sanitized recovery notes, not invented replacement code. If a verified copy is found on another machine, import it through a secret-scanned PR and document its provenance.

## Maintainer next steps

1. Review the migration diff and open the PR from the link above.
2. Confirm no secrets, logs, credentials, or machine runtime state are included, then merge through normal review.
3. Provision secret files outside Git with owner-only permissions and install pinned dependencies in a dedicated virtual environment.
4. Run the tests, compilation checks, CSV checks, and secret scan again from the merge candidate.
5. Run `runtime/executor.py --once` with `ARMED=0` and compare claimed/synced counts against the current executor.
6. Confirm unknown Campaign names remain unmapped and are not assigned to Solvea.
7. Schedule a separately approved cutover window; stop and unload the old `com.11agents.ads-executor` process before starting the new daemon.
8. Start the new daemon with `ARMED=0` and observe at least two successful cycles. Verify that only one executor is claiming actions.
9. Obtain written approval before setting `ARMED=1`. Keep `ALLOW_ENABLE=0` until a separate launch approval explicitly permits Campaign resume/enable.
10. Update the telemetry cron only during the approved cutover, then record the cutover time, operator, config hash, first claimed action ID, and first successful sync.

## Rollback

1. Set `ARMED=0` immediately.
2. Stop the new daemon.
3. Verify no action remains claimed but unreported.
4. Restart the old daemon only after confirming it will be the sole claimant.
5. Preserve action IDs, timestamps, Google Ads mutation results, and logs for reconciliation.

## Product-specific gates

- Flatkey: do not scale until first top-up/revenue attribution and the activation funnel are trustworthy.
- VOC AI: repair the documented GTM, cross-domain GCLID, and signup-route blockers before interpreting zero conversions.
- Solvea: App campaigns remain gated by runtime/account connection and real-device revenue-event QA.

No product may scale from CTR, CPC, install, or signup volume alone. The primary decision inputs are verified realized revenue, CAC, ROAS, refund quality, and payback.
