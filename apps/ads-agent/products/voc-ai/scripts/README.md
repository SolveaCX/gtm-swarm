# VOC AI historical mutation scripts

These scripts document and reproduce specific 2026-07 Google Ads changes. They are not an always-on runtime and must not be scheduled.

Every script requires:

- `GOOGLE_ADS_CUSTOMER_ID`
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` when using an MCC
- `GOOGLE_ADS_ENV` pointing to a secret file outside Git
- `ADS_MUTATION_APPROVED=1` for that invocation

Before execution, inspect the current Google Ads account and compare hard-coded Campaign/ad-group names and budgets against the approved change. Prefer `validate_only` where the script supports it. Migration into this repository is not approval to rerun historical mutations.
