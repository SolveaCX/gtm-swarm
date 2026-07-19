---
name: solvea-app-paid-growth
description: Run revenue-accountable paid acquisition for the Solvea iOS app, starting with pause-first Apple Search Ads and strict attribution, budget, and profit gates.
---

# Solvea App Paid Growth

Use this skill for every paid acquisition task whose primary product is the Solvea app.

## North Star

- Company target: USD 10,000,000 in realized revenue.
- Optimize for verified subscription and credit-purchase revenue, not installs, clicks, or signups.
- Report profit contribution and payback whenever gross-margin and retention inputs are available.
- An install is only an intermediate event. Never call an install-only campaign successful.

## Product and launch facts

- Product: Solvea AI Business Phone.
- Website: https://solvea.cx
- US App Store ID: 6771256977.
- iOS bundle ID: cx.solvea.ios.app.ticket.prod.
- Baseline checked version: 1.11, released 2026-07-08.
- Wave 1 market: United States, English, iOS 17+.
- Core promise: a separate business number plus AI answering for calls a small business cannot take.
- Primary high-intent jobs: business phone number, AI receptionist, work phone number, missed-call coverage.
- Do not claim review volume, star rating, savings, conversion lift, or revenue impact unless the current source is attached and verified.

## Mandatory operating order

1. Verify destination, offer, pricing, App Store state, target geography, excluded claims, and approved budget.
2. Verify the revenue event chain on a real device before enabling spend.
3. Build or import campaigns in PAUSED state.
4. QA targeting, match types, negatives, CPT/bid, daily caps, creative, destination, and attribution.
5. Record reviewer/operator approval and the hard maximum spend.
6. Enable only the approved campaigns.
7. Reconcile platform spend to product revenue every day.
8. Stop, iterate, or scale only from the decision rules below.

If a required connector, credential, event, approval, or budget limit is missing, create an explicit blocker and keep campaigns paused. Never imply that a launch succeeded without platform campaign IDs, enabled status, and delivery/spend evidence.

## Attribution contract

The required event chain is:

1. `install`
2. `business_number_created`
3. `ai_answering_enabled`
4. `first_ai_answered_call`
5. `subscription_started`
6. `credits_purchased`

Every downstream event must carry or resolve to:

- acquisition channel, campaign, ad group/ad set, keyword or creative ID;
- install timestamp and event timestamp;
- App Store transaction/subscription identifier where permitted;
- realized USD revenue, refund state, and currency normalization;
- privacy-safe user/device identity allowed by platform policy.

Do not activate Google App campaigns, Meta app campaigns, or automated value optimization until downstream app attribution is connected and a real-device test proves the chain through `subscription_started`. SKAdNetwork-only install visibility is not sufficient for revenue scaling.

## Wave 1: Apple Search Ads

Initial hard budget: USD 150/day for 7 days, maximum USD 1,050. Do not increase or extend without a reviewed decision supported by revenue data.

| Campaign | Daily cap | Intent |
| --- | ---: | --- |
| Business Phone | $55 | business phone app, business phone number app, small business phone app |
| AI Receptionist | $55 | ai receptionist app, ai phone answering, virtual receptionist app |
| Work Number | $30 | work phone number, second number for business, separate work phone number |
| Brand Defense | $10 | solvea, solvea app, solvea ai business phone |

Structure each intent in its own campaign/ad group so keyword, ad message, App Store destination, and onboarding promise remain aligned. Start with exact and tightly controlled phrase/broad discovery only when negatives and search-term review are in place. Brand and non-brand results must be reported separately.

## Channel gates

- Apple Search Ads: first active channel after account binding, paused import, and event QA.
- Google Search: may be prepared in PAUSED state; enable only with a verified App Store/deep-link destination and downstream app revenue attribution.
- Meta: creative testing may be prepared in PAUSED state; enable only after app event attribution and creative-policy QA.
- TikTok: remains out of Wave 1 unless explicitly approved as a separate experiment.
- Never shift budget between channels merely to increase delivery.

## Decision rules

At keyword or lowest controllable unit:

- 20 taps with zero installs: pause.
- 5 installs with zero `business_number_created`: pause and inspect promise/onboarding mismatch.
- Any spend with broken or untrusted downstream attribution: pause affected campaigns.
- Any campaign approaching its approved daily or total hard maximum: stop or cap before breach.
- Never scale from CTR, CPC, CPI, or trial volume alone.

Scale eligibility requires all of:

- verified `subscription_started` or `credits_purchased` revenue;
- revenue reconciliation without material unexplained variance;
- acceptable CAC/payback against the latest approved unit economics;
- no policy, refund, or low-quality lead anomaly;
- at least one complete review window with stable measurement.

When unit economics are not supplied, report the break-even CAC formula and request gross margin, refund rate, retention/churn, and net realized revenue before recommending scale.

## Required outputs

For campaign build tasks, return:

- campaign/ad-group structure and PAUSED/ENABLED state;
- keyword or audience list and negatives/exclusions;
- ad copy or creative manifest mapped to one intent each;
- destination/deep link and App Store alignment;
- tracking fields and event QA evidence;
- approved daily cap, total cap, start/end window, and owner;
- platform IDs or a precise manual import artifact;
- blocker list and explicit launch status.

For daily monitoring, publish one revenue-accountable snapshot containing:

- spend, impressions, taps/clicks, CTR, CPC/CPT, installs, CPI;
- business numbers created, AI answering enabled, first AI calls;
- paid users, subscription revenue, credit revenue, refunds, realized revenue;
- CAC, install-to-number rate, number-to-paid rate, ROAS, payback when available;
- reconciliation by channel/campaign and tracking anomalies;
- exact decisions taken: pause, keep, iterate, or reviewed scale proposal.

## First implementation queue

Work in this order and do not bypass blockers:

1. Task #154 — Connect Apple Search Ads to Paid Ads Agent. P0, currently blocked until account/runtime binding exists.
2. Task #155 — Implement iOS paid acquisition attribution events. P0.
3. Task #156 — Import Solvea ASA Wave 1 campaigns in PAUSED state. P1.
4. Task #157 — QA the real-device funnel and enable ASA Wave 1. P1, blocked until #154-#156 pass.

The canonical launch package is this module's `wave1/` directory. When the runtime can access project artifacts, use its keyword CSV, negative list, creative manifest, measurement spec, and launch dashboard; otherwise attach the import-ready artifacts to the assigned production task.

## Reporting language

Use these status labels exactly:

- `NOT CONNECTED` — platform/runtime unavailable.
- `READY TO IMPORT` — artifacts complete but not created in platform.
- `IMPORTED / PAUSED` — platform objects exist and cannot spend.
- `QA PASSED / PAUSED` — tracking and settings passed, awaiting enable approval.
- `LIVE` — enabled with platform IDs and delivery confirmed.
- `PAUSED BY RULE` — stopped by an explicit budget, attribution, or performance rule.

Never use `LIVE`, `LAUNCHED`, or “投放成功” based only on a plan, CSV, dashboard, task creation, or reviewer approval.

