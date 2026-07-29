#!/usr/bin/env python3
"""Launch the isolated Flatkey Tools landing-page A/B test on Google Search.

The campaign is created paused, verified, and only enabled with ``--enable``.
It uses one unshared USD 50/day budget across three single-intent ad groups.
Each group contains two otherwise-identical RSAs so only the landing-page
system changes between variant A (workflow proof) and B (spec sheet).

Usage:
  python3 launch_tools_landing_test.py --dry-run
  ADS_MUTATION_APPROVED=1 python3 launch_tools_landing_test.py --apply --enable
"""

from __future__ import annotations

import argparse
import json
import os
import re
import urllib.request
from dataclasses import dataclass


CUSTOMER_ID = "2752299046"
LOGIN_CUSTOMER_ID = "7153662160"
CAMPAIGN_NAME = "flatkey-US-Tools-Landing-Test"
BUDGET_NAME = "flatkey-US-Tools-Landing-Test-budget"
BUDGET_USD = 50.0
CPC_CAP_USD = 3.0
US_LOCATION = "geoTargetConstants/2840"
ENGLISH_LANGUAGE = "languageConstants/1000"
FINAL_URL_SUFFIX = (
    "campaign_id={campaignid}&ad_group_id={adgroupid}&creative_id={creative}"
    "&keyword={keyword}&match_type={matchtype}&network={network}&device={device}"
    "&location_id={loc_physical_ms}"
)

CAMPAIGN_NEGATIVES = (
    "free download",
    "crack",
    "tutorial",
    "course",
    "jobs",
    "salary",
    "movie",
    "mobile app",
    "google tag manager",
    "facebook marketplace",
    "amazon marketplace",
)


@dataclass(frozen=True)
class GroupSpec:
    name: str
    intent: str
    path1: str
    path2: str
    keywords: tuple[tuple[str, str], ...]
    headlines: tuple[str, ...]
    descriptions: tuple[str, ...]
    landing_a: str
    landing_b: str


def tracked_url(path: str, intent: str, variant: str) -> str:
    return (
        f"https://flatkey.ai{path}?utm_source=google&utm_medium=cpc"
        f"&utm_campaign=flatkey-us-tools-lp-test&utm_content={intent}-{variant}"
        f"&lp_variant={variant}"
    )


GROUPS = (
    GroupSpec(
        name="SKAG | web scraping api",
        intent="web-scraping-api",
        path1="web-scraping",
        path2="api",
        keywords=(
            ("web scraping api", "EXACT"),
            ("web scraping api", "PHRASE"),
            ("web scraper api", "PHRASE"),
            ("website scraping api", "EXACT"),
        ),
        headlines=(
            "Web Scraping API",
            "Web Data for AI Agents",
            "One Key for Supported Tools",
            "Price Visible Before Run",
            "Inspect Schema Before Spend",
            "Run a Bounded Web Job",
            "Structured Web Data",
            "One Prepaid Balance",
            "Keep Result and Charge",
            "Browse Live Tool Contracts",
            "Start With One API Call",
            "Flatkey Web Tools",
        ),
        descriptions=(
            "Run supported web data tools with one Flatkey key. Inspect the contract before execution.",
            "See the exact Flatkey price before a billable run, then reconcile the returned charge.",
            "Start with one bounded URL and keep only the workflow that passes your output checks.",
            "Continue into supported AI models and tools using the same prepaid Flatkey balance.",
        ),
        landing_a=tracked_url("/tools/web-scraping-api", "web-scraping-api", "a"),
        landing_b=tracked_url(
            "/lp/tools-ads/claude/web-scraping-api", "web-scraping-api", "b"
        ),
    ),
    GroupSpec(
        name="SKAG | google search api",
        intent="google-search-api",
        path1="google-search",
        path2="api",
        keywords=(
            ("google search api", "EXACT"),
            ("google search api", "PHRASE"),
            ("serp api", "EXACT"),
            ("serp api", "PHRASE"),
            ("search results api", "PHRASE"),
        ),
        headlines=(
            "Google Search API",
            "SERP Data for AI Agents",
            "Structured Search Results",
            "Source URLs Preserved",
            "Price Visible Before Run",
            "Search With One API Key",
            "One Query. One Balance.",
            "Research After Search",
            "Compare Live Tool Contracts",
            "Start With One Query",
            "Flatkey Search Tools",
        ),
        descriptions=(
            "Run supported search tools with one Flatkey key and preserve source URLs in the result.",
            "Set query, market, language, and result depth. Inspect the exact price before execution.",
            "Compare live tool contracts, then research or summarize with the same prepaid balance.",
            "Start with one bounded query and measure the cost of the accepted downstream result.",
        ),
        landing_a=tracked_url("/tools/google-search-api", "google-search-api", "a"),
        landing_b=tracked_url(
            "/lp/tools-ads/claude/google-search-api", "google-search-api", "b"
        ),
    ),
    GroupSpec(
        name="SKAG | apify alternative lp",
        intent="apify-alternative",
        path1="apify",
        path2="alternative",
        keywords=(
            ("apify alternative", "EXACT"),
            ("apify alternative", "PHRASE"),
            ("alternative to apify", "EXACT"),
            ("apify pricing", "EXACT"),
        ),
        headlines=(
            "Apify Alternative",
            "Compare Flatkey Tools",
            "Move One Workflow First",
            "Verify Live Tool Coverage",
            "One Key for Supported Tools",
            "Price Visible Before Run",
            "Compare Result and Cost",
            "Keep Apify as a Fallback",
            "One Prepaid Balance",
            "Inspect Schema Before Spend",
            "Browse Flatkey Tools",
        ),
        descriptions=(
            "Flatkey is not a replacement for every Actor. Verify live tool coverage before migrating.",
            "Compare one supported workflow by output quality, latency, and final request charge.",
            "Use one Flatkey key and prepaid balance across supported metered tools and AI models.",
            "Keep your current path as fallback. Move only the workflow that passes your checks.",
        ),
        landing_a=tracked_url("/apify-alternative", "apify-alternative", "a"),
        landing_b=tracked_url(
            "/lp/tools-ads/claude/apify-alternative", "apify-alternative", "b"
        ),
    ),
)


def validate_specs() -> None:
    errors: list[str] = []
    if len(GROUPS) != 3:
        errors.append("exactly three single-intent ad groups are required")
    urls: set[str] = set()
    for group in GROUPS:
        if not 3 <= len(group.headlines) <= 15:
            errors.append(f"{group.name}: RSA must contain 3-15 headlines")
        if not 2 <= len(group.descriptions) <= 4:
            errors.append(f"{group.name}: RSA must contain 2-4 descriptions")
        for headline in group.headlines:
            if len(headline) > 30:
                errors.append(f"{group.name}: headline exceeds 30 chars: {headline!r}")
        for description in group.descriptions:
            if len(description) > 90:
                errors.append(
                    f"{group.name}: description exceeds 90 chars: {description!r}"
                )
        for variant, url in (("a", group.landing_a), ("b", group.landing_b)):
            if not url.startswith("https://flatkey.ai/") or "localhost" in url:
                errors.append(f"{group.name}: invalid production URL: {url}")
            if f"lp_variant={variant}" not in url:
                errors.append(f"{group.name}: landing variant is not attributable: {url}")
            if url in urls:
                errors.append(f"duplicate landing URL: {url}")
            urls.add(url)
    if len(urls) != 6:
        errors.append("the campaign must exercise six unique landing URLs")
    if errors:
        raise ValueError("\n".join(errors))


def probe_destinations() -> list[dict[str, str | int]]:
    results: list[dict[str, str | int]] = []
    for group in GROUPS:
        for variant, url in (("a", group.landing_a), ("b", group.landing_b)):
            request = urllib.request.Request(
                url,
                headers={"User-Agent": "AdsBot-Google (+http://www.google.com/adsbot.html)"},
            )
            with urllib.request.urlopen(request, timeout=25) as response:
                final_url = response.geturl()
                response.read(1024)
                if response.status != 200:
                    raise RuntimeError(f"destination returned {response.status}: {url}")
                if not final_url.startswith("https://flatkey.ai/"):
                    raise RuntimeError(f"destination escaped flatkey.ai: {url} -> {final_url}")
                results.append(
                    {
                        "intent": group.intent,
                        "variant": variant,
                        "status": response.status,
                        "final_url": final_url,
                    }
                )
    return results


def load_config(path: str) -> dict[str, str]:
    config: dict[str, str] = {}
    with open(os.path.expanduser(path), encoding="utf-8") as handle:
        for raw in handle:
            match = re.match(r"([A-Z_]+)=(.*)", raw.strip())
            if match:
                config[match.group(1)] = match.group(2).strip().strip("\"'")
    return config


def google_client():
    from google.ads.googleads.client import GoogleAdsClient

    candidates = (
        os.environ.get("GOOGLE_ADS_ENV"),
        "~/.config/gtm-swarm/google-ads.env",
        "~/google-ads/config/.env",
    )
    config_path = next(
        (os.path.expanduser(path) for path in candidates if path and os.path.exists(os.path.expanduser(path))),
        None,
    )
    if not config_path:
        raise RuntimeError("Google Ads config file was not found")
    config = load_config(config_path)
    values = {
        "developer_token": config.get("GOOGLE_ADS_DEVELOPER_TOKEN")
        or config.get("DEVELOPER_TOKEN"),
        "client_id": config.get("GOOGLE_ADS_CLIENT_ID") or config.get("CLIENT_ID"),
        "client_secret": config.get("GOOGLE_ADS_CLIENT_SECRET")
        or config.get("CLIENT_SECRET"),
        "refresh_token": config.get("GOOGLE_ADS_REFRESH_TOKEN")
        or config.get("REFRESH_TOKEN"),
        "login_customer_id": config.get("LOGIN_CUSTOMER_ID")
        or config.get("LOGIN_CID")
        or LOGIN_CUSTOMER_ID,
        "use_proto_plus": True,
    }
    missing = [key for key, value in values.items() if not value and key != "use_proto_plus"]
    if missing:
        raise RuntimeError(f"missing Google Ads config: {', '.join(missing)}")
    return GoogleAdsClient.load_from_dict(values)


def text_asset(client, value: str):
    asset = client.get_type("AdTextAsset")
    asset.text = value
    return asset


def search_one(client, query: str):
    rows = list(
        client.get_service("GoogleAdsService").search(
            customer_id=CUSTOMER_ID, query=query
        )
    )
    if len(rows) > 1:
        raise RuntimeError("expected at most one matching Google Ads resource")
    return rows[0] if rows else None


def get_campaign(client):
    return search_one(
        client,
        f"""
          SELECT campaign.id, campaign.resource_name, campaign.name, campaign.status,
                 campaign.campaign_budget, campaign.bidding_strategy_type,
                 campaign.target_spend.cpc_bid_ceiling_micros,
                 campaign.geo_target_type_setting.positive_geo_target_type,
                 campaign.final_url_suffix, campaign_budget.resource_name,
                 campaign_budget.amount_micros, campaign_budget.explicitly_shared
          FROM campaign
          WHERE campaign.name = '{CAMPAIGN_NAME}' AND campaign.status != 'REMOVED'
        """,
    )


def create_campaign(client):
    budget_service = client.get_service("CampaignBudgetService")
    budget_operation = client.get_type("CampaignBudgetOperation")
    budget = budget_operation.create
    budget.name = BUDGET_NAME
    budget.amount_micros = int(BUDGET_USD * 1_000_000)
    budget.explicitly_shared = False
    budget.delivery_method = client.enums.BudgetDeliveryMethodEnum.STANDARD
    budget_result = budget_service.mutate_campaign_budgets(
        customer_id=CUSTOMER_ID, operations=[budget_operation]
    )

    operation = client.get_type("CampaignOperation")
    campaign = operation.create
    campaign.name = CAMPAIGN_NAME
    campaign.status = client.enums.CampaignStatusEnum.PAUSED
    campaign.advertising_channel_type = client.enums.AdvertisingChannelTypeEnum.SEARCH
    campaign.campaign_budget = budget_result.results[0].resource_name
    campaign.network_settings.target_google_search = True
    campaign.network_settings.target_search_network = False
    campaign.network_settings.target_content_network = False
    campaign.network_settings.target_partner_search_network = False
    campaign.geo_target_type_setting.positive_geo_target_type = (
        client.enums.PositiveGeoTargetTypeEnum.PRESENCE
    )
    campaign.target_spend.cpc_bid_ceiling_micros = int(CPC_CAP_USD * 1_000_000)
    campaign.final_url_suffix = FINAL_URL_SUFFIX
    try:
        campaign.contains_eu_political_advertising = (
            client.enums.EuPoliticalAdvertisingStatusEnum.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING
        )
    except Exception:
        pass
    result = client.get_service("CampaignService").mutate_campaigns(
        customer_id=CUSTOMER_ID, operations=[operation]
    )
    return result.results[0].resource_name


def ensure_campaign_criteria(client, campaign_resource: str) -> None:
    service = client.get_service("CampaignCriterionService")
    operations = []
    location = client.get_type("CampaignCriterionOperation")
    location.create.campaign = campaign_resource
    location.create.location.geo_target_constant = US_LOCATION
    operations.append(location)
    language = client.get_type("CampaignCriterionOperation")
    language.create.campaign = campaign_resource
    language.create.language.language_constant = ENGLISH_LANGUAGE
    operations.append(language)
    for value in CAMPAIGN_NEGATIVES:
        negative = client.get_type("CampaignCriterionOperation")
        negative.create.campaign = campaign_resource
        negative.create.negative = True
        negative.create.keyword.text = value
        negative.create.keyword.match_type = client.enums.KeywordMatchTypeEnum.PHRASE
        operations.append(negative)
    service.mutate_campaign_criteria(customer_id=CUSTOMER_ID, operations=operations)


def ensure_purchase_only_goal(client, campaign_id: int) -> None:
    ga = client.get_service("GoogleAdsService")
    rows = list(
        ga.search(
            customer_id=CUSTOMER_ID,
            query=f"""
              SELECT campaign_conversion_goal.resource_name,
                     campaign_conversion_goal.category,
                     campaign_conversion_goal.origin,
                     campaign_conversion_goal.biddable
              FROM campaign_conversion_goal WHERE campaign.id = {campaign_id}
            """,
        )
    )
    operations = []
    for row in rows:
        goal = row.campaign_conversion_goal
        desired = goal.category.name == "PURCHASE" and goal.origin.name == "WEBSITE"
        if bool(goal.biddable) == desired:
            continue
        operation = client.get_type("CampaignConversionGoalOperation")
        operation.update.resource_name = goal.resource_name
        operation.update.biddable = desired
        operation.update_mask.paths.append("biddable")
        operations.append(operation)
    if operations:
        client.get_service("CampaignConversionGoalService").mutate_campaign_conversion_goals(
            customer_id=CUSTOMER_ID, operations=operations
        )


def create_groups(client, campaign_resource: str) -> None:
    group_service = client.get_service("AdGroupService")
    criterion_service = client.get_service("AdGroupCriterionService")
    ad_service = client.get_service("AdGroupAdService")
    for spec in GROUPS:
        operation = client.get_type("AdGroupOperation")
        group = operation.create
        group.name = spec.name
        group.campaign = campaign_resource
        group.type_ = client.enums.AdGroupTypeEnum.SEARCH_STANDARD
        group.status = client.enums.AdGroupStatusEnum.PAUSED
        group.cpc_bid_micros = int(CPC_CAP_USD * 1_000_000)
        group.ad_rotation_mode = client.enums.AdGroupAdRotationModeEnum.ROTATE_FOREVER
        response = group_service.mutate_ad_groups(
            customer_id=CUSTOMER_ID, operations=[operation]
        )
        group_resource = response.results[0].resource_name

        keyword_operations = []
        for text, match_type in spec.keywords:
            keyword = client.get_type("AdGroupCriterionOperation")
            criterion = keyword.create
            criterion.ad_group = group_resource
            criterion.status = client.enums.AdGroupCriterionStatusEnum.PAUSED
            criterion.keyword.text = text
            criterion.keyword.match_type = getattr(
                client.enums.KeywordMatchTypeEnum, match_type
            )
            keyword_operations.append(keyword)
        criterion_service.mutate_ad_group_criteria(
            customer_id=CUSTOMER_ID, operations=keyword_operations
        )

        ad_operations = []
        for variant, final_url in (("A", spec.landing_a), ("B", spec.landing_b)):
            ad_operation = client.get_type("AdGroupAdOperation")
            group_ad = ad_operation.create
            group_ad.ad_group = group_resource
            group_ad.status = client.enums.AdGroupAdStatusEnum.PAUSED
            group_ad.ad.name = f"Flatkey {spec.intent} | LP-{variant}"
            group_ad.ad.final_urls.append(final_url)
            group_ad.ad.responsive_search_ad.headlines.extend(
                [text_asset(client, value) for value in spec.headlines]
            )
            group_ad.ad.responsive_search_ad.descriptions.extend(
                [text_asset(client, value) for value in spec.descriptions]
            )
            group_ad.ad.responsive_search_ad.path1 = spec.path1
            group_ad.ad.responsive_search_ad.path2 = spec.path2
            ad_operations.append(ad_operation)
        ad_service.mutate_ad_group_ads(
            customer_id=CUSTOMER_ID, operations=ad_operations
        )


def compact_state(client) -> dict[str, object] | None:
    row = get_campaign(client)
    if not row:
        return None
    campaign = row.campaign
    campaign_id = int(campaign.id)
    ga = client.get_service("GoogleAdsService")
    criteria = []
    for item in ga.search(
        customer_id=CUSTOMER_ID,
        query=f"""
          SELECT campaign_criterion.type, campaign_criterion.negative,
                 campaign_criterion.location.geo_target_constant,
                 campaign_criterion.language.language_constant,
                 campaign_criterion.keyword.text
          FROM campaign_criterion WHERE campaign.id = {campaign_id}
            AND campaign_criterion.status != 'REMOVED'
        """,
    ):
        criterion = item.campaign_criterion
        criteria.append(
            {
                "type": criterion.type_.name,
                "negative": bool(criterion.negative),
                "location": criterion.location.geo_target_constant,
                "language": criterion.language.language_constant,
                "keyword": criterion.keyword.text,
            }
        )
    groups = []
    for item in ga.search(
        customer_id=CUSTOMER_ID,
        query=f"""
          SELECT ad_group.id, ad_group.resource_name, ad_group.name, ad_group.status,
                 ad_group.ad_rotation_mode
          FROM ad_group WHERE campaign.id = {campaign_id}
            AND ad_group.status != 'REMOVED'
        """,
    ):
        group = item.ad_group
        groups.append(
            {
                "id": str(group.id),
                "resource_name": group.resource_name,
                "name": group.name,
                "status": group.status.name,
                "rotation": group.ad_rotation_mode.name,
            }
        )
    keywords = []
    for item in ga.search(
        customer_id=CUSTOMER_ID,
        query=f"""
          SELECT ad_group.name, ad_group_criterion.resource_name,
                 ad_group_criterion.status, ad_group_criterion.keyword.text,
                 ad_group_criterion.keyword.match_type
          FROM keyword_view WHERE campaign.id = {campaign_id}
            AND ad_group_criterion.status != 'REMOVED'
        """,
    ):
        criterion = item.ad_group_criterion
        keywords.append(
            {
                "group": item.ad_group.name,
                "resource_name": criterion.resource_name,
                "text": criterion.keyword.text,
                "match_type": criterion.keyword.match_type.name,
                "status": criterion.status.name,
            }
        )
    ads = []
    for item in ga.search(
        customer_id=CUSTOMER_ID,
        query=f"""
          SELECT ad_group.name, ad_group_ad.resource_name, ad_group_ad.status,
                 ad_group_ad.policy_summary.approval_status,
                 ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.final_urls
          FROM ad_group_ad WHERE campaign.id = {campaign_id}
            AND ad_group_ad.status != 'REMOVED'
        """,
    ):
        group_ad = item.ad_group_ad
        ads.append(
            {
                "group": item.ad_group.name,
                "resource_name": group_ad.resource_name,
                "id": str(group_ad.ad.id),
                "name": group_ad.ad.name,
                "status": group_ad.status.name,
                "approval": group_ad.policy_summary.approval_status.name,
                "final_urls": list(group_ad.ad.final_urls),
            }
        )
    goals = []
    for item in ga.search(
        customer_id=CUSTOMER_ID,
        query=f"""
          SELECT campaign_conversion_goal.category, campaign_conversion_goal.origin,
                 campaign_conversion_goal.biddable
          FROM campaign_conversion_goal WHERE campaign.id = {campaign_id}
        """,
    ):
        goal = item.campaign_conversion_goal
        if goal.biddable:
            goals.append({"category": goal.category.name, "origin": goal.origin.name})
    return {
        "campaign_id": str(campaign_id),
        "campaign_resource": campaign.resource_name,
        "campaign_status": campaign.status.name,
        "budget_resource": row.campaign_budget.resource_name,
        "budget_usd": row.campaign_budget.amount_micros / 1_000_000,
        "budget_shared": bool(row.campaign_budget.explicitly_shared),
        "bidding": campaign.bidding_strategy_type.name,
        "cpc_cap_usd": campaign.target_spend.cpc_bid_ceiling_micros / 1_000_000,
        "presence": campaign.geo_target_type_setting.positive_geo_target_type.name,
        "final_url_suffix": campaign.final_url_suffix,
        "criteria": criteria,
        "groups": sorted(groups, key=lambda value: value["name"]),
        "keywords": sorted(keywords, key=lambda value: (value["group"], value["text"], value["match_type"])),
        "ads": sorted(ads, key=lambda value: (value["group"], value["name"])),
        "biddable_goals": goals,
    }


def assert_staged_state(state: dict[str, object]) -> None:
    if state["budget_usd"] != BUDGET_USD or state["budget_shared"]:
        raise RuntimeError("campaign budget is not isolated at USD 50/day")
    if state["bidding"] != "TARGET_SPEND" or state["cpc_cap_usd"] != CPC_CAP_USD:
        raise RuntimeError("campaign is not Maximize Clicks with the expected CPC cap")
    if state["presence"] != "PRESENCE":
        raise RuntimeError("campaign location mode is not presence-only")
    if state["final_url_suffix"] != FINAL_URL_SUFFIX:
        raise RuntimeError("campaign attribution suffix drift")
    positive_locations = {
        item["location"]
        for item in state["criteria"]
        if item["type"] == "LOCATION" and not item["negative"]
    }
    languages = {
        item["language"]
        for item in state["criteria"]
        if item["type"] == "LANGUAGE" and not item["negative"]
    }
    negative_keywords = {
        item["keyword"].casefold()
        for item in state["criteria"]
        if item["type"] == "KEYWORD" and item["negative"]
    }
    if positive_locations != {US_LOCATION} or languages != {ENGLISH_LANGUAGE}:
        raise RuntimeError("campaign must target US presence and English only")
    if not set(CAMPAIGN_NEGATIVES).issubset(negative_keywords):
        raise RuntimeError("campaign negative keyword coverage drift")
    if state["biddable_goals"] != [{"category": "PURCHASE", "origin": "WEBSITE"}]:
        raise RuntimeError("campaign must bid only on website purchase")
    if len(state["groups"]) != 3 or len(state["ads"]) != 6:
        raise RuntimeError("campaign does not contain three groups and six LP ads")
    expected_urls = {url for group in GROUPS for url in (group.landing_a, group.landing_b)}
    actual_urls = {url for ad in state["ads"] for url in ad["final_urls"]}
    if actual_urls != expected_urls:
        raise RuntimeError("landing-page experiment URL mismatch")


def enable_all(client, state: dict[str, object]) -> None:
    campaign_operation = client.get_type("CampaignOperation")
    campaign_operation.update.resource_name = state["campaign_resource"]
    campaign_operation.update.status = client.enums.CampaignStatusEnum.ENABLED
    campaign_operation.update_mask.paths.append("status")
    group_operations = []
    for group in state["groups"]:
        operation = client.get_type("AdGroupOperation")
        operation.update.resource_name = group["resource_name"]
        operation.update.status = client.enums.AdGroupStatusEnum.ENABLED
        operation.update_mask.paths.append("status")
        group_operations.append(operation)
    keyword_operations = []
    for keyword in state["keywords"]:
        operation = client.get_type("AdGroupCriterionOperation")
        operation.update.resource_name = keyword["resource_name"]
        operation.update.status = client.enums.AdGroupCriterionStatusEnum.ENABLED
        operation.update_mask.paths.append("status")
        keyword_operations.append(operation)
    ad_operations = []
    for ad in state["ads"]:
        operation = client.get_type("AdGroupAdOperation")
        operation.update.resource_name = ad["resource_name"]
        operation.update.status = client.enums.AdGroupAdStatusEnum.ENABLED
        operation.update_mask.paths.append("status")
        ad_operations.append(operation)
    client.get_service("AdGroupCriterionService").mutate_ad_group_criteria(
        customer_id=CUSTOMER_ID, operations=keyword_operations
    )
    client.get_service("AdGroupAdService").mutate_ad_group_ads(
        customer_id=CUSTOMER_ID, operations=ad_operations
    )
    client.get_service("AdGroupService").mutate_ad_groups(
        customer_id=CUSTOMER_ID, operations=group_operations
    )
    client.get_service("CampaignService").mutate_campaigns(
        customer_id=CUSTOMER_ID, operations=[campaign_operation]
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--enable", action="store_true")
    args = parser.parse_args()
    validate_specs()
    destinations = probe_destinations()
    plan = {
        "campaign": CAMPAIGN_NAME,
        "daily_budget_usd": BUDGET_USD,
        "bidding": "Maximize Clicks",
        "cpc_cap_usd": CPC_CAP_USD,
        "market": "United States, presence only",
        "groups": [group.name for group in GROUPS],
        "landing_pages": destinations,
        "guardrails": {
            "budget_shared": False,
            "purchase_only_biddable": True,
            "auto_tagging_required": True,
            "rsa_per_group": 2,
        },
    }
    if args.dry_run or not args.apply:
        print(json.dumps({"mode": "dry-run", "plan": plan}, indent=2))
        return
    if os.environ.get("ADS_MUTATION_APPROVED") != "1":
        raise RuntimeError("mutation blocked: set ADS_MUTATION_APPROVED=1 after approval")

    client = google_client()
    auto_tagging = search_one(
        client, "SELECT customer.auto_tagging_enabled FROM customer LIMIT 1"
    )
    if not auto_tagging or not auto_tagging.customer.auto_tagging_enabled:
        raise RuntimeError("Google Ads auto-tagging is disabled")

    existing = get_campaign(client)
    if not existing:
        campaign_resource = create_campaign(client)
        ensure_campaign_criteria(client, campaign_resource)
        campaign_id = int(campaign_resource.rsplit("/", 1)[-1])
        ensure_purchase_only_goal(client, campaign_id)
    else:
        campaign_resource = existing.campaign.resource_name
        campaign_id = int(existing.campaign.id)
        ensure_purchase_only_goal(client, campaign_id)
    partial_state = compact_state(client)
    if not partial_state:
        raise RuntimeError("campaign could not be read back after creation")
    if not partial_state["groups"]:
        create_groups(client, campaign_resource)
    elif {group["name"] for group in partial_state["groups"]} != {
        spec.name for spec in GROUPS
    }:
        raise RuntimeError("partial ad-group state requires manual audit")
    state = compact_state(client)
    if not state:
        raise RuntimeError("campaign could not be read back after creation")
    assert_staged_state(state)
    if args.enable:
        enable_all(client, state)
        state = compact_state(client)
        if not state or state["campaign_status"] != "ENABLED":
            raise RuntimeError("campaign did not enable")
        if any(group["status"] != "ENABLED" for group in state["groups"]):
            raise RuntimeError("one or more ad groups did not enable")
        if any(ad["status"] != "ENABLED" for ad in state["ads"]):
            raise RuntimeError("one or more ads did not enable")
    print(
        json.dumps(
            {
                "mode": "enabled" if args.enable else "staged-paused",
                "plan": plan,
                "state": state,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
