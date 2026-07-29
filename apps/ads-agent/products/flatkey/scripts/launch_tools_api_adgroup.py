#!/usr/bin/env python3
"""Launch Flatkey's high-intent Tools & API ad group in the US search campaign.

The script is idempotent: it reuses the named ad group, skips existing
keywords, and creates an RSA only when the group has no non-removed ad.

Usage:
  python3 launch_tools_api_adgroup.py --dry-run
  ADS_MUTATION_APPROVED=1 python3 launch_tools_api_adgroup.py --enable
"""

import argparse
import os
import re
import sys

from google.protobuf import field_mask_pb2


CUSTOMER_ID = "2752299046"
CAMPAIGN_NAME = "flatkey-US-Search"
AD_GROUP_NAME = "Tools API & GTM Data"
CPC_BID_USD = 3.00
FINAL_URL = (
    "https://flatkey.ai/"
    "?utm_source=google&utm_medium=cpc&utm_campaign=flatkey-US-Search"
    "&utm_content=tools-api&campaign_id={campaignid}"
    "&ad_group_id={adgroupid}&creative_id={creative}&keyword={keyword}"
    "&match_type={matchtype}&network={network}&device={device}"
    "&placement={placement}&target_id={targetid}"
    "&location_id={loc_physical_ms}#screen-two"
)

KEYWORDS = (
    ("ai tools api", "PHRASE"),
    ("ai agent tools", "PHRASE"),
    ("ai agent tools api", "PHRASE"),
    ("tools api for ai agents", "PHRASE"),
    ("data enrichment api", "PHRASE"),
    ("enrichment api", "PHRASE"),
    ("company enrichment api", "PHRASE"),
    ("gtm data api", "PHRASE"),
    ("gtm tools api", "PHRASE"),
    ("api marketplace", "PHRASE"),
    ("mcp tools", "PHRASE"),
    ("mcp tools api", "PHRASE"),
    ("mcp data api", "PHRASE"),
    ("pay per use data api", "PHRASE"),
    ("deepline", "EXACT"),
    ("deepline alternative", "EXACT"),
    ("monid", "EXACT"),
    ("monid alternative", "EXACT"),
)

NEGATIVE_KEYWORDS = (
    ("jobs", "PHRASE"),
    ("salary", "PHRASE"),
    ("movie", "PHRASE"),
    ("chatgpt alternative", "PHRASE"),
    ("mobile app", "PHRASE"),
    ("google tag manager", "PHRASE"),
    ("tag manager", "PHRASE"),
    ("facebook marketplace", "PHRASE"),
    ("amazon marketplace", "PHRASE"),
    ("walmart marketplace", "PHRASE"),
    ("ebay marketplace", "PHRASE"),
    ("forehead", "PHRASE"),
    ("eyebrow", "PHRASE"),
    ("wrinkle", "PHRASE"),
    ("skin", "PHRASE"),
)

HEADLINES = (
    "Flatkey Tools API",
    "1,000+ AI Tools, One Key",
    "One API for Models & Tools",
    "Pay Per Successful Call",
    "Replace Data Tool Seats",
    "Tools for AI Agents",
    "Search, Enrich & Automate",
    "GTM Data APIs, One Balance",
    "MCP, SDK & API Access",
    "No Separate Provider Keys",
    "One Key. One Bill.",
    "Use Tools From Your Agent",
    "Start With One API Key",
)

DESCRIPTIONS = (
    "Run search, browser, enrichment, media, and action tools through one Flatkey balance.",
    "Give agents 1,000+ pay-per-call tools plus 300+ models—without separate seats or keys.",
    "Use one normalized API for GTM data and AI tools. Pay only for successful calls.",
    "Connect Claude Code, Codex, OpenClaw, or your own app. One key, one bill.",
)


def validate_assets():
    errors = []
    if len(HEADLINES) < 3 or len(HEADLINES) > 15:
        errors.append("RSA must have 3-15 headlines")
    if len(DESCRIPTIONS) < 2 or len(DESCRIPTIONS) > 4:
        errors.append("RSA must have 2-4 descriptions")
    for text in HEADLINES:
        if len(text) > 30:
            errors.append("headline exceeds 30 chars: %r (%d)" % (text, len(text)))
    for text in DESCRIPTIONS:
        if len(text) > 90:
            errors.append("description exceeds 90 chars: %r (%d)" % (text, len(text)))
    if not FINAL_URL.startswith("https://flatkey.ai/"):
        errors.append("final URL must stay on flatkey.ai")
    if errors:
        raise ValueError("\n".join(errors))


def load_google_config(path):
    config = {}
    with open(os.path.expanduser(path), encoding="utf-8") as handle:
        for raw in handle:
            match = re.match(r"([A-Z_]+)=(.*)", raw.strip())
            if match:
                config[match.group(1)] = match.group(2).strip().strip('"')
    return config


def google_client():
    from google.ads.googleads.client import GoogleAdsClient

    path = os.environ.get(
        "GOOGLE_ADS_ENV", os.path.expanduser("~/.config/gtm-swarm/google-ads.env")
    )
    config = load_google_config(path)
    required = ("DEVELOPER_TOKEN", "CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN")
    missing = [key for key in required if not config.get(key)]
    if missing:
        raise RuntimeError("missing Google Ads config: %s" % ", ".join(missing))
    return GoogleAdsClient.load_from_dict(
        {
            "developer_token": config["DEVELOPER_TOKEN"],
            "client_id": config["CLIENT_ID"],
            "client_secret": config["CLIENT_SECRET"],
            "refresh_token": config["REFRESH_TOKEN"],
            "login_customer_id": (
                os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID")
                or config.get("LOGIN_CUSTOMER_ID")
                or config.get("LOGIN_CID")
            ),
            "use_proto_plus": True,
        }
    )


def text_asset(client, text):
    asset = client.get_type("AdTextAsset")
    asset.text = text
    return asset


def current_state(client):
    google_ads = client.get_service("GoogleAdsService")
    campaigns = list(
        google_ads.search(
            customer_id=CUSTOMER_ID,
            query=(
                "SELECT campaign.id, campaign.name, campaign.status "
                "FROM campaign WHERE campaign.name = '%s' "
                "AND campaign.status != 'REMOVED'" % CAMPAIGN_NAME
            ),
        )
    )
    if len(campaigns) != 1:
        raise RuntimeError(
            "expected exactly one active campaign named %s, found %d"
            % (CAMPAIGN_NAME, len(campaigns))
        )
    campaign = campaigns[0].campaign
    groups = list(
        google_ads.search(
            customer_id=CUSTOMER_ID,
            query=(
                "SELECT ad_group.id, ad_group.name, ad_group.status, "
                "ad_group.resource_name FROM ad_group "
                "WHERE campaign.id = %d AND ad_group.name = '%s' "
                "AND ad_group.status != 'REMOVED'" % (campaign.id, AD_GROUP_NAME)
            ),
        )
    )
    if len(groups) > 1:
        raise RuntimeError("duplicate non-removed ad groups named %s" % AD_GROUP_NAME)
    return campaign, groups[0].ad_group if groups else None


def create_ad_group(client, campaign):
    service = client.get_service("AdGroupService")
    operation = client.get_type("AdGroupOperation")
    group = operation.create
    group.name = AD_GROUP_NAME
    group.campaign = campaign.resource_name
    group.type_ = client.enums.AdGroupTypeEnum.SEARCH_STANDARD
    group.status = client.enums.AdGroupStatusEnum.PAUSED
    group.cpc_bid_micros = int(CPC_BID_USD * 1_000_000)
    response = service.mutate_ad_groups(customer_id=CUSTOMER_ID, operations=[operation])
    resource_name = response.results[0].resource_name
    print("created paused ad group: %s" % resource_name)
    return resource_name


def add_missing_keywords(client, ad_group_resource):
    google_ads = client.get_service("GoogleAdsService")
    group_id = int(ad_group_resource.rsplit("/", 1)[-1])
    existing = set()
    for row in google_ads.search(
        customer_id=CUSTOMER_ID,
        query=(
            "SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, "
            "ad_group_criterion.negative FROM ad_group_criterion "
            "WHERE ad_group.id = %d AND ad_group_criterion.type = 'KEYWORD' "
            "AND ad_group_criterion.status != 'REMOVED'" % group_id
        ),
    ):
        criterion = row.ad_group_criterion
        existing.add(
            (
                criterion.keyword.text.casefold(),
                criterion.keyword.match_type.name,
                bool(criterion.negative),
            )
        )

    service = client.get_service("AdGroupCriterionService")
    operations = []
    for text, match_type in KEYWORDS:
        if (text.casefold(), match_type, False) in existing:
            continue
        operation = client.get_type("AdGroupCriterionOperation")
        criterion = operation.create
        criterion.ad_group = ad_group_resource
        criterion.status = client.enums.AdGroupCriterionStatusEnum.ENABLED
        criterion.keyword.text = text
        criterion.keyword.match_type = client.enums.KeywordMatchTypeEnum[match_type]
        operations.append(operation)
    for text, match_type in NEGATIVE_KEYWORDS:
        if (text.casefold(), match_type, True) in existing:
            continue
        operation = client.get_type("AdGroupCriterionOperation")
        criterion = operation.create
        criterion.ad_group = ad_group_resource
        criterion.status = client.enums.AdGroupCriterionStatusEnum.ENABLED
        criterion.negative = True
        criterion.keyword.text = text
        criterion.keyword.match_type = client.enums.KeywordMatchTypeEnum[match_type]
        operations.append(operation)
    if operations:
        service.mutate_ad_group_criteria(
            customer_id=CUSTOMER_ID, operations=operations
        )
    print("keywords ready: %d positive, %d negative" % (len(KEYWORDS), len(NEGATIVE_KEYWORDS)))


def ensure_responsive_search_ad(client, ad_group_resource):
    google_ads = client.get_service("GoogleAdsService")
    group_id = int(ad_group_resource.rsplit("/", 1)[-1])
    ads = list(
        google_ads.search(
            customer_id=CUSTOMER_ID,
            query=(
                "SELECT ad_group_ad.ad.id FROM ad_group_ad "
                "WHERE ad_group.id = %d AND ad_group_ad.status != 'REMOVED'" % group_id
            ),
        )
    )
    if ads:
        print("RSA already exists; skipped creation")
        return
    service = client.get_service("AdGroupAdService")
    operation = client.get_type("AdGroupAdOperation")
    group_ad = operation.create
    group_ad.ad_group = ad_group_resource
    group_ad.status = client.enums.AdGroupAdStatusEnum.ENABLED
    group_ad.ad.final_urls.append(FINAL_URL)
    group_ad.ad.responsive_search_ad.headlines.extend(
        [text_asset(client, text) for text in HEADLINES]
    )
    group_ad.ad.responsive_search_ad.descriptions.extend(
        [text_asset(client, text) for text in DESCRIPTIONS]
    )
    group_ad.ad.responsive_search_ad.path1 = "tools"
    group_ad.ad.responsive_search_ad.path2 = "api"
    service.mutate_ad_group_ads(customer_id=CUSTOMER_ID, operations=[operation])
    print("responsive search ad created; Google review pending")


def enable_ad_group(client, ad_group_resource):
    service = client.get_service("AdGroupService")
    operation = client.get_type("AdGroupOperation")
    operation.update.resource_name = ad_group_resource
    operation.update.status = client.enums.AdGroupStatusEnum.ENABLED
    client.copy_from(operation.update_mask, field_mask_pb2.FieldMask(paths=["status"]))
    service.mutate_ad_groups(customer_id=CUSTOMER_ID, operations=[operation])
    print("ad group enabled")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--enable", action="store_true")
    args = parser.parse_args()
    validate_assets()
    print(
        "validated: %d headlines, %d descriptions, %d keywords, %d negatives"
        % (len(HEADLINES), len(DESCRIPTIONS), len(KEYWORDS), len(NEGATIVE_KEYWORDS))
    )
    if args.dry_run:
        print("dry run: %s -> %s" % (CAMPAIGN_NAME, AD_GROUP_NAME))
        return
    if os.environ.get("ADS_MUTATION_APPROVED") != "1":
        raise RuntimeError(
            "mutation blocked: set ADS_MUTATION_APPROVED=1 after explicit approval"
        )

    client = google_client()
    campaign, group = current_state(client)
    if campaign.status.name != "ENABLED":
        raise RuntimeError("target campaign is not enabled")
    resource_name = group.resource_name if group else create_ad_group(client, campaign)
    add_missing_keywords(client, resource_name)
    ensure_responsive_search_ad(client, resource_name)
    if args.enable:
        enable_ad_group(client, resource_name)
    else:
        print("ad group remains paused; pass --enable after review")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("ERROR: %s" % error, file=sys.stderr)
        raise
