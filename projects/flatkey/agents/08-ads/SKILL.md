# Agent 08-ads — compatibility skill

The canonical multi-product implementation is `apps/ads-agent/`.

## Operating contract

1. Read `apps/ads-agent/playbooks/PAID_ADS_PLAYBOOK.md` before any Campaign build, audit, optimization, or scale decision.
2. Load the assigned product package from `apps/ads-agent/products/<product>/`.
3. Treat Agent identity, assignment, runtime, connectors, and approvals as database state; do not read legacy `agent.yaml` as production truth.
4. Start new Campaign objects paused and verify geography, negatives, budgets, landing pages, and attribution before enabling.
5. Optimize for verified paid revenue, CAC, ROAS, refunds, and payback—not CTR, installs, or registrations.
6. Use `apps/ads-agent/runtime/` only through an approved runtime with secret-managed credentials.
7. Never call a Campaign live without platform IDs, enabled state, and delivery/spend evidence.

## Product packages

- Flatkey: `apps/ads-agent/products/flatkey/`
- VOC AI: `apps/ads-agent/products/voc-ai/`
- Solvea: `apps/ads-agent/products/solvea/`

## Daily telemetry

When assigned `collect_daily_telemetry`, collect only the assigned product's Campaigns, return the required `swarm.telemetry.v1` observations, and reconcile spend to paid revenue. Unknown Campaign prefixes must be reported as unmapped instead of assigned to Solvea.
