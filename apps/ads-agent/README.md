# GTM Swarm Ads Agent

Canonical repository module for paid-acquisition execution, Google Ads telemetry, product campaign packages, and revenue-accountable operating rules.

## Scope

This module consolidates the previously machine-local Ads Agent assets for:

- Flatkey — funnel repair and paid-search operating playbook.
- VOC AI — live Google Search campaign artifacts, one-time mutation scripts, and conversion-tracking incident documentation.
- Solvea — App paid-growth skill, Apple Search Ads Wave 1, paused Google/Meta assets, measurement contract, dashboards, and creatives.

The shared runtime claims approved actions from 11Agents, applies supported Google Ads API operations, reports outcomes, and synchronizes campaign/keyword/search-term telemetry.

## Source-of-truth boundary

- GitHub is the review source for code, playbooks, campaign artifacts, schemas, and migration history.
- Multica/11Agents databases are the production source for Agent identity, task assignment, runtime, connector, approval, and action state.
- Google Ads remains the source for actual Campaign status, delivery, spend, bids, and platform IDs.
- Credentials, refresh tokens, platform passwords, project tokens, logs, and local daemon state never enter Git.

## Layout

```text
apps/ads-agent/
├── README.md
├── HANDOFF.md
├── MIGRATION_INVENTORY.md
├── config.example.env
├── requirements.txt
├── runtime/
│   ├── executor.py
│   └── push_daily_stats.py
├── deploy/
│   └── com.11agents.ads-executor.plist.example
├── docs/
│   └── EXECUTOR_CONTRACT.md
├── playbooks/
│   └── PAID_ADS_PLAYBOOK.md
└── products/
    ├── flatkey/
    ├── voc-ai/
    └── solvea/
```

## Safety defaults

- `ARMED=0` is dry-run and is the required default.
- `ALLOW_ENABLE=0` blocks `resume` even when other mutations are armed.
- VOC one-time mutation scripts require `ADS_MUTATION_APPROVED=1` for every invocation.
- Unknown Campaign prefixes are skipped; they are never silently assigned to Solvea.
- Campaign creation/import artifacts start `PAUSED` unless an approved runbook explicitly says otherwise.
- Budget increases require an action-level `max_daily_budget` and reviewed approval.

## Configuration

Copy `config.example.env` to a secret-managed path outside Git, then set:

```bash
export ADS_AGENT_ENV="$HOME/.config/gtm-swarm/ads-agent.env"
export GOOGLE_ADS_ENV="$HOME/.config/gtm-swarm/google-ads.env"
```

Install dependencies:

```bash
python3 -m venv .venv
.venv/bin/pip install -r apps/ads-agent/requirements.txt
```

Run a single dry-run synchronization cycle:

```bash
ARMED=0 .venv/bin/python apps/ads-agent/runtime/executor.py --once
```

Do not activate the migrated daemon until the old machine-local executor is stopped and the cutover checklist in `HANDOFF.md` is signed off. Two armed executors must never run against the same action queue.
