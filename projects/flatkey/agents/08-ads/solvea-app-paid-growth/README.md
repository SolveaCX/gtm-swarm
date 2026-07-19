# Solvea Ads Agent

This directory is the Git-reviewed maintenance source for Solvea's paid-acquisition capability.

## Canonical location

- Repository: <https://github.com/SolveaCX/gtm-swarm>
- Existing Ads Agent module: <https://github.com/SolveaCX/gtm-swarm/tree/main/projects/flatkey/agents/08-ads>
- Solvea capability package: <https://github.com/SolveaCX/gtm-swarm/tree/feat/solvea-ads-agent/projects/flatkey/agents/08-ads/solvea-app-paid-growth>
- Production Agent: <https://app.11agents.ai/tenant/9034be95-5adb-4a36-a969-95f693196fbb/dashboard/solvea/agents/56471a25-d3df-4570-bd36-518580860096>
- Solvea Ads dashboard: <https://app.11agents.ai/tenant/9034be95-5adb-4a36-a969-95f693196fbb/dashboard/solvea/ads>

## Source-of-truth boundary

- GitHub is the review and maintenance source for the skill, campaign artifacts, copy, measurement contract, and operating history.
- Multica/11Agents databases are the runtime source of truth for Agent identity, assignment, status, runtime, connectors, and task state.
- Do not add `agent.yaml`, filesystem content-bank state, credentials, tokens, or production runtime state here.
- A Git merge does not update the production Agent automatically. After merge, sync the skill and attachments through the authenticated production workflow and verify file names and hashes.
- The parent `projects/flatkey/agents/08-ads/` directory is a legacy multi-product Ads Agent module. Keep Solvea-specific assets in this subdirectory so they do not overwrite the existing Flatkey campaign material.

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
