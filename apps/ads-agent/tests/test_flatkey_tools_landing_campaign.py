import runpy
from pathlib import Path


SCRIPT = (
    Path(__file__).parents[1]
    / "products"
    / "flatkey"
    / "scripts"
    / "launch_tools_landing_test.py"
)
MODULE = runpy.run_path(SCRIPT)


def test_campaign_has_one_isolated_ten_dollar_stop_loss_budget():
    assert MODULE["BUDGET_USD"] == 10.0
    assert MODULE["CAMPAIGN_NAME"] == "flatkey-US-Tools-Landing-Test"
    assert MODULE["CPC_CAP_USD"] == 3.0


def test_three_intents_cover_six_unique_attributable_production_pages():
    groups = MODULE["GROUPS"]
    assert len(groups) == 3
    urls = {url for group in groups for url in (group.landing_a, group.landing_b)}
    assert len(urls) == 6
    assert all(url.startswith("https://flatkey.ai/") for url in urls)
    assert all("localhost" not in url for url in urls)
    assert sum("lp_variant=a" in url for url in urls) == 3
    assert sum("lp_variant=b" in url for url in urls) == 3


def test_rsa_assets_fit_google_limits_and_apify_copy_is_bounded():
    MODULE["validate_specs"]()
    for group in MODULE["GROUPS"]:
        assert all(len(value) <= 30 for value in group.headlines)
        assert all(len(value) <= 90 for value in group.descriptions)
    apify = next(group for group in MODULE["GROUPS"] if group.intent == "apify-alternative")
    assert "not a replacement for every Actor" in apify.descriptions[0]
