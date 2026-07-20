# Solvea Ads Agent

This directory is the Git-reviewed maintenance source for Solvea's paid-acquisition capability.

## Canonical location

- Repository: <https://github.com/SolveaCX/gtm-swarm>
- Consolidated Ads Agent: <https://github.com/SolveaCX/gtm-swarm/tree/feat/google-ads-agent-migration/apps/ads-agent>
- Solvea capability package: <https://github.com/SolveaCX/gtm-swarm/tree/feat/google-ads-agent-migration/apps/ads-agent/products/solvea>
- Production Agent: <https://app.11agents.ai/tenant/<TENANT_ID>/dashboard/solvea/agents/<AGENT_ID>>
- Solvea Ads dashboard: <https://app.11agents.ai/tenant/<TENANT_ID>/dashboard/solvea/ads>

## Source-of-truth boundary

- GitHub is the review and maintenance source for the skill, campaign artifacts, copy, measurement contract, and operating history.
- Multica/11Agents databases are the runtime source of truth for Agent identity, assignment, status, runtime, connectors, and task state.
- Do not add `agent.yaml`, filesystem content-bank state, credentials, tokens, or production runtime state here.
- A Git merge does not update the production Agent automatically. After merge, sync the skill and attachments through the authenticated production workflow and verify file names and hashes.
- Keep Solvea-specific assets in this product package so they do not overwrite Flatkey or VOC AI campaign material.

## Current launch status

- Campaigns are not live and no ad-spend evidence has been recorded.
- Paid Ads Agent is waiting for a usable runtime and Apple Search Ads connection.
- Wave 1 starts with Apple Search Ads in the United States, English, iOS 17+.
- Approved hard ceiling: USD 150/day for seven days, USD 1,050 total.

## Files

- `SKILL.md` — Solvea-specific operating contract and profit gates.
- `HANDOFF.md` — maintenance and production handoff.
- `wave1/apple-search-ads-keywords.csv` — pause-first ASA build.
- `wave1/google-search-rsa.csv` — Google Search draft; keep paused until attribution passes.
- `wave1/meta-creative-manifest.csv` — Meta creative manifest; keep paused until attribution passes.
- `wave1/measurement-spec.csv` — activation and revenue event contract.
- `wave1/negative-keywords.txt` — initial Google exclusions.
