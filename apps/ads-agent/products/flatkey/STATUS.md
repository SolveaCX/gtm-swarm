# Flatkey Google Ads — Migration Status

This is a sanitized recovery summary extracted from the former machine memory. It contains no OAuth values, platform passwords, or admin tokens.

## Last known operating state

- Multi-market Google Search ran across English, Japan, Germany, Brazil/Portuguese, Spanish LATAM, India, Southeast Asia, and emerging Africa during 2026-06/07.
- A 2026-07-09 loss-control decision reduced total daily budget from approximately USD 200 to USD 60.
- Last recorded allocation: emerging Africa USD 25/day, English USD 20/day, India USD 10/day, Portuguese/Brazil USD 5/day.
- Southeast Asia and Spanish LATAM were paused in that decision.
- The recorded reason was severe revenue underperformance: approximately USD 5,067 cumulative spend versus USD 20 advertising-attributed revenue at that review point.
- One confirmed advertising-to-payment path existed, but the payment/onboarding funnel remained the primary constraint.

These values are historical evidence, not authority to mutate the current account. Query Google Ads and product revenue before making any decision.

## Required decision gates

- Preserve GCLID/GBRAID/UTM through signup, activation, order, payment, and refund.
- Treat signup as observation; optimize toward first successful API use and first top-up/realized revenue.
- Do not restore paused markets merely because CPC is low.
- Scale only after attributable paid users, acceptable CAC/gross-profit payback, and a stable refund/fraud profile.
- Apply presence-only geography, shared negatives, and auto-apply-off account hygiene.

## Tools landing-page experiment (2026-07-29)

- Executor: `scripts/launch_tools_landing_test.py`
- Isolated campaign: `flatkey-US-Tools-Landing-Test`
- Initial budget: USD 50/day, unshared; Maximize Clicks with USD 3 CPC cap.
- Stop-loss on 2026-07-31: capped at USD 10/day until the first attributable
  registration or top-up; the legacy US token campaign and DE remain paused.
- Three single-intent groups: Web Scraping API, Google Search API, Apify Alternative.
- Each group contains two otherwise-identical RSAs that test the workflow-proof
  landing system against the Claude Opus 5 specification-sheet system.
- All six URLs must return HTTP 200 to an AdsBot user agent before mutation.
- Only website purchase is biddable; signup remains observation-only.
- Live Google Ads campaign ID: `24079453161`; budget resource
  `15757262556`; enabled on 2026-07-29 with all six RSAs submitted for review.
- Initial readback: campaign `LEARNING`, USD 0 spend, six ads `ENABLED` with
  approval `UNKNOWN` and no policy topics yet (normal immediately after submit).

## Stop-loss and PT revenue reconciliation (2026-07-31)

- Reproducible executor: `scripts/optimize_flatkey_20260731.py`.
- The isolated Tools campaign is capped at USD 10/day. The legacy US token
  campaign, DE campaign, and duplicate legacy `Tools API & GTM Data` ad group
  remain paused.
- The stale `utm_content=chatgpt-api-alternative` campaign suffix was removed
  from legacy US. Only dynamic ValueTrack dimensions remain at campaign level.
- PT runs one traffic cell (`PT-Core`); every other PT ad group is paused.
- The original 29-signup PT snapshot was re-queried after more traffic arrived.
  The same `one-integration` cohort then contained 50 signups, two initiated
  top-up orders, and zero settled payments. This is a genuine post-signup
  conversion failure, not missing Purchase uploads for those users.
- A wider PT history audit found six older settled top-ups across two paid users
  (USD 40.00 and BRL 299.60) that predated the transactional attribution outbox.
  `scripts/backfill_pt_purchase_outbox.py` idempotently repaired two signup
  bindings and all six Purchase events. The revenue executor subsequently
  reported all six Purchase events uploaded with no delivery error.
- The sole PT funnel experiment is `pt_first_call_topup_v2`: after signup, send
  the user directly to the Playground, measure the first successful API call
  against a 60-second target, and open the top-up prompt only after success.

## Missing local assets

The previously documented `~/google-ads/` scripts, dashboards, reports, and editor files were no longer present during this migration; only the secret `.env` remained and was explicitly excluded. They cannot be represented as migrated code. If another machine has a verified copy, import it through a separate reviewed PR after a secret scan.

The previously exposed/duplicated OAuth material must be treated as compromised and rotated before any new runtime cutover.
