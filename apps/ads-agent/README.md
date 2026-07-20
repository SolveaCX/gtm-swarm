# GTM Swarm Ads Agent

Canonical repository module for paid-acquisition execution, Google Ads telemetry, product campaign packages, and revenue-accountable operating rules.

## Scope

This module consolidates the previously machine-local Ads Agent assets for:

- Flatkey — funnel repair and paid-search operating playbook.
- VOC AI — live Google Search campaign artifacts, one-time mutation scripts, and conversion-tracking incident documentation.
- Solvea — App paid-growth skill, Apple Search Ads Wave 1, paused Google/Meta assets, measurement contract, dashboards, and creatives.

The shared runtime claims approved actions from 11Agents, applies supported Google Ads API operations, reports outcomes, and synchronizes campaign/keyword/search-term telemetry.

It also owns the product-neutral paid-click revenue loop: the platform captures
`gclid` / `gbraid` / `wbraid`, binds signup to `user_id`, queues settled purchase
value, and the local executor uploads purchases and refund adjustments to Google
Ads. See `docs/REVENUE_ATTRIBUTION.md`.

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
│   ├── com.11agents.ads-executor.plist.example
│   └── com.11agents.x-ads-sync.plist.example
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

Revenue uploads require a separate `ENABLE_REVENUE_UPLOADS=1` gate in addition
to `ARMED=1`; Campaign write approval alone never enables conversion uploads.

Do not activate the migrated daemon until the old machine-local executor is stopped and the cutover checklist in `HANDOFF.md` is signed off. Two armed executors must never run against the same action queue.

## X Ads read-only telemetry

`runtime/x_ads_sync.py` reads a non-secret JSON config, fetches X Ads campaign
delivery via OAuth 1.0a, and builds the shared GTM telemetry contract. Importing
the module performs no network or Keychain access. Its fixed telemetry identity
is:

- `agent_id=paid-ads-agent`
- `agent_key=ads-agent`
- `platform=paid_ads`
- `artifact_type=campaign`

The default command performs X Ads `GET` requests for the later of Campaign
start or the previous 30 days, then prints only a safe summary. It does not
write to GTM Swarm:

```bash
.venv/bin/python apps/ads-agent/runtime/x_ads_sync.py \
  --config apps/ads-agent/products/flatkey/x-ads.json
```

Only the explicit `--push` form sends the credential-free batch to
`https://gtm.shulex.com/api/swarm/ingest`:

```bash
.venv/bin/python apps/ads-agent/runtime/x_ads_sync.py \
  --config apps/ads-agent/products/flatkey/x-ads.json \
  --push
```

The Flatkey display name maps to the production GTM workspace slug
`pricing-analyse`; never replace it with the display name in telemetry. The
workspace config contains only non-secret IDs, targeting, budget, and start
time. Inline credential-shaped JSON fields are rejected.

Runtime secrets are resolved from explicit environment variables or these
macOS Keychain services:

| Value | Environment | Keychain service |
|---|---|---|
| X API key | `X_ADS_API_KEY` | `codex-x-ads-api-key` |
| X API secret | `X_ADS_API_SECRET` | `codex-x-ads-api-secret` |
| X access token | `X_ADS_ACCESS_TOKEN` | `codex-x-ads-access-token` |
| X access-token secret | `X_ADS_ACCESS_TOKEN_SECRET` | `codex-x-ads-access-token-secret` |
| GTM workspace token | `GTM_SWARM_TOKEN_PRICING_ANALYSE` | service `gtm-swarm-workspace-token`, account `pricing-analyse` |

`GTM_SWARM_TOKEN` is a single-workspace fallback. The workspace token is not
resolved at all unless `--push` is present. Never put secret values in a JSON
config, command line, log, or Git.

Each observation always emits numeric values for `spend_usd`, `impressions`,
`link_clicks`, `ctr_percent`, `cpc_usd`, `conversions`, `revenue_usd`, and
`roas`; unavailable/null source metrics become zero. `conversions` is an X
platform metric. X conversion-value fields are not treated as verified money,
so `revenue_usd` and `roas` remain zero until independent Flatkey payment
attribution is connected. The attached dashboard spec uses those exact widget
IDs and a `campaigns` leaderboard.

For hourly collection, copy and fill the non-secret placeholders in
`deploy/com.11agents.x-ads-sync.plist.example`. It runs the same config with
`--push` every 3600 seconds, contains no secret values, and requires
`__EXTERNAL_LOG_DIR__` to resolve outside the repository. Before loading it,
unload the existing Flatkey X Ads sync LaunchAgent and confirm it is stopped.
Never run two jobs that write the same workspace/campaign telemetry stream.
