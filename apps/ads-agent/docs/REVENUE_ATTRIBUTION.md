# Ads Agent Revenue Attribution Contract

This is the shared, product-neutral path from a paid click to realized revenue:

```text
gclid / gbraid / wbraid
  -> 90-day first paid-touch cookie + localStorage
  -> signup binds click id to product user_id
  -> successful charge queues actual value + currency + order_id
  -> Ads executor uploads the purchase to Google Ads
  -> refund uploads a conversion adjustment
```

UTM fields are supporting dimensions only. They must never replace a Google
click ID when an order is attributed to a Campaign, ad group, or keyword.

## Browser capture

Load the shared SDK on every paid landing page:

```html
<script src="https://app.11agents.ai/ads-attribution.js"></script>
```

It automatically captures `gclid`, `gbraid`, or `wbraid`, preserves the first
paid touch for 90 days in both a first-party cookie and localStorage, and exposes
`window.AdsAttribution.get()`. `attachToForm(form)` adds the payload as a hidden
`ads_attribution` field. The click ID must go to the product backend; do not put a
project bearer token in browser code.

For a marketing-domain to app-domain signup link, call
`AdsAttribution.decorateLinks('a[data-ads-attribution]')` or
`appendToUrl(url)`. The destination SDK imports the structured payload from the
`ads_attribution` query parameter into its own first-party storage. Product
backends must still validate the submitted shape; cross-domain localStorage does
not exist.

## Product backend writes

All writes use the exact `(tenant_id, project_slug)` and that project's bearer
token. A slug alone is never authorization.

### Signup

`POST /api/tenants/{tenant_id}/projects/{slug}/ads/attribution/signup`

```json
{
  "event_id": "signup:user_123",
  "user_id": "user_123",
  "occurred_at": "2026-07-20T22:10:00Z",
  "attribution": {
    "click_id_type": "gclid",
    "click_id": "...",
    "captured_at": "2026-07-20T21:00:00Z",
    "landing_path": "/pricing",
    "utm": {"utm_source": "google", "utm_campaign": "brand"}
  }
}
```

Signup is a Secondary/observation conversion. It carries zero value and must
not share the purchase conversion action.

### Purchase

Call from the authoritative payment-success webhook, not from the success page:

`POST /api/tenants/{tenant_id}/projects/{slug}/ads/attribution/revenue`

```json
{
  "event_type": "purchase",
  "event_id": "stripe:payment_intent.succeeded:pi_123",
  "user_id": "user_123",
  "order_id": "pi_123",
  "value": 49.50,
  "currency": "USD",
  "occurred_at": "2026-07-20T22:30:00Z"
}
```

The amount and currency must come from Stripe's settled object. `event_id` and
`order_id` make retries idempotent.

### Refund

Full refund:

```json
{
  "event_type": "refund",
  "event_id": "stripe:charge.refunded:re_123",
  "user_id": "user_123",
  "order_id": "pi_123",
  "value": 49.50,
  "currency": "USD",
  "adjustment_type": "retraction",
  "occurred_at": "2026-07-21T10:00:00Z"
}
```

For a partial refund use `adjustment_type=restatement`, pass `value` as the
cumulative refunded amount, and pass `adjusted_value` as the remaining net order
value. The platform rejects a refund whose numbers do not reconcile to the
original purchase.

## Google Ads configuration

Each project config has its own Google customer ID, Secondary signup conversion
action, Primary purchase conversion action, timezone, and 90-day lookback. The
platform rejects a config that reuses one action for signup and purchase.

The executor does not claim revenue while disarmed. Live upload requires both:

```text
ARMED=1
ENABLE_REVENUE_UPLOADS=1
```

This second gate is deliberate: Campaign mutation approval is not permission to
send revenue conversions.

## Reconciliation

Weekly, sample orders across matched, unmatched, refunded, and high-value groups.
For each sample compare Stripe `order_id`, settled amount, currency, timestamp,
refund state, platform delivery result, and Google Ads conversion value. Scale is
blocked while match rate, duplicate rate, or value variance is unexplained.
