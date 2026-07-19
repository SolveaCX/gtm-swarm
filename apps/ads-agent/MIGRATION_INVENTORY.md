# Google Ads Agent Migration Inventory

Migration date: 2026-07-19

## Included sources

| Previous local source | New repository location | Classification |
| --- | --- | --- |
| `~/ads-executor/executor.py` | `runtime/executor.py` | Shared approved-action executor and telemetry sync |
| `~/voc-ads/push_daily_stats.py` | `runtime/push_daily_stats.py` | Shared Google Ads → 11Agents data pipeline |
| `~/voc-ads/google-ads-editor/` | `products/voc-ai/google-ads-editor/` | Import-ready Campaign, keyword, RSA, and negative CSVs |
| `~/voc-ads/*.py` except telemetry | `products/voc-ai/scripts/` | Historical one-time Google Ads mutation/validation tools |
| `~/voc-ads/{README,STATUS,ticket,plan}` | `products/voc-ai/` | Operating state and conversion incident context |
| `~/flatkey-ads/agent101-takeaways-2026-07-12.md` | `products/flatkey/PLAYBOOK.md` | Flatkey profit-funnel playbook |
| `~/solvea-ads/launch-2026-07-14/` | `products/solvea/` | Solvea campaign package, dashboards, screenshots, and creatives |
| `~/.agents/skills/ads-playbook/SKILL.md` | `playbooks/PAID_ADS_PLAYBOOK.md` | Shared paid-acquisition discipline |
| `11agents-ai/platform/docs/ads-keyword-executor-contract.md` | `docs/EXECUTOR_CONTRACT.md` | Platform queue/sync contract snapshot |
| Sanitized Claude memory summaries | `products/flatkey/STATUS.md`, `products/solvea/LEGACY_GOOGLE_ADS_JP.md` | Recovery context for assets no longer present on disk |

## Explicitly excluded

- `~/google-ads/config/.env` — developer token and OAuth credentials.
- `~/ads-executor/.env` — platform login, account configuration, and arming state.
- `~/.11agents/credentials` — project bearer tokens.
- `~/ads-executor/executor.log` and `~/voc-ads/push.log` — machine logs and possible operational data.
- Launchd runtime state, process IDs, caches, virtual environments, and Python bytecode.
- Claude JSONL sessions, file-history snapshots, conflict copies, and raw memory files. Some contain credential values or stale machine state.

## Normalization applied

- Replaced machine-specific credential paths with environment-configurable secret paths.
- Removed the unsafe fallback that classified every unknown Campaign as Solvea.
- Added an independent enable gate (`ALLOW_ENABLE`) to the shared executor.
- Added `ADS_MUTATION_APPROVED=1` to every migrated VOC write script.
- Kept current live/paused status as documentation only; migration itself does not mutate Google Ads.
- Preserved existing Campaign artifacts and binary creative assets without changing their advertising claims.

## External dependencies that remain in place

- `11Agents/11agents-ai` continues to own the authenticated `/api/ads-executor/claim`, `/report`, and `/sync` routes plus server-side queue/database logic. They are dependencies, not duplicated runtime ownership.
- The active crontab still invokes the old `~/voc-ads/push_daily_stats.py` until a separately approved cutover. Repository migration does not modify that cron entry.
- The active launchd service still points to `~/ads-executor/executor.py` until cutover. Running both old and new armed executors is prohibited.

## Unrecoverable-from-this-machine sources

Former memory referenced a much larger `~/google-ads/` sprint workspace and Flatkey dashboard/scripts. At migration time the directory contained only `config/.env`; executable assets were absent. Sanitized status records were created, but missing code was not invented. A verified copy from another machine can be imported later through a secret-scanned PR.
