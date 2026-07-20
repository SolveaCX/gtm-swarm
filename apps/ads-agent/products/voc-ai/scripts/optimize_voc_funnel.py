#!/usr/bin/env python3
"""Apply the 2026-07-19 VOC Ads intent + landing-page cleanup.

Scope is deliberately narrow:
- no budget, bidding strategy, campaign status, or conversion changes;
- pause the low-intent review-pain ad group;
- pause three over-broad phrase keywords and add exact high-intent variants;
- add campaign negatives derived from the 2026-07-18 search-term audit;
- route each ad group to a matching VOC landing page.

The script validates every mutation batch before applying it and is idempotent.
"""

from __future__ import annotations

import os
import re

from google.ads.googleads.client import GoogleAdsClient
from google.api_core import protobuf_helpers


CID = os.environ.get("GOOGLE_ADS_CUSTOMER_ID", "")
LOGIN_CID = os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") or None

# Campaign IDs come from the environment (public repo — no real account IDs in code).
# Set VOC_CAMPAIGN_IDS='Name1=id1,Name2=id2,...' before running.
CAMPAIGN_IDS = dict(
    kv.split("=", 1)
    for kv in os.environ.get("VOC_CAMPAIGN_IDS", "").split(",")
    if "=" in kv
)

EXACT_KEYWORDS = {
    "mcp": [
        "amazon mcp",
        "amazon mcp server",
        "amazon data mcp",
        "ecommerce mcp server",
        "mcp server for ecommerce data",
    ],
    "amazon-data": [
        "amazon data",
        "amazon product data",
        "amazon review data",
        "amazon reviews data",
        "amazon review dataset",
    ],
    "data-api": [
        "amazon product data api",
        "amazon reviews api",
        "amazon keyword data api",
        "amazon product review dataset",
    ],
}

PAUSE_PHRASE_KEYWORDS = {
    "amazon-data": {"amazon data", "amazon product data", "ecommerce dataset"},
}

NEGATIVES = {
    "VOC-API-MCP-Dev-US": [
        ("how many sales", "PHRASE"),
        ("how many items sold", "PHRASE"),
        ("price history", "PHRASE"),
        ("sales estimator", "PHRASE"),
        ("data center", "PHRASE"),
        ("sp api", "PHRASE"),
        ("ucsd", "BROAD"),
        ("kaggle", "BROAD"),
    ],
    "VOC-Agent-Conquest-US": [
        ("checker", "BROAD"),
        ("fake review", "PHRASE"),
        ("complaints", "BROAD"),
        ("consumer reports", "PHRASE"),
    ],
    "VOC-Agent-Category-US": [
        ("checker", "BROAD"),
        ("fake review", "PHRASE"),
        ("complaints", "BROAD"),
        ("consumer reports", "PHRASE"),
    ],
}

FINAL_URLS = {
    "mcp": "https://www.voc.ai/api-mcp?utm_source=google&utm_medium=cpc&utm_campaign=api-mcp-dev&utm_content=mcp",
    "amazon-data": "https://www.voc.ai/api-mcp?utm_source=google&utm_medium=cpc&utm_campaign=api-mcp-dev&utm_content=amazon-data",
    "data-api": "https://www.voc.ai/api-mcp?utm_source=google&utm_medium=cpc&utm_campaign=api-mcp-dev&utm_content=data-api",
    "review-tools": "https://www.voc.ai/product/voice-of-customer-analysis?utm_source=google&utm_medium=cpc&utm_campaign=conquest&utm_content=review-tools",
    "helium10-alt": "https://www.voc.ai/features/best-helium-10-alternative?utm_source=google&utm_medium=cpc&utm_campaign=conquest&utm_content=helium10-alt",
    "junglescout-alt": "https://www.voc.ai/features/competitor-analysis?utm_source=google&utm_medium=cpc&utm_campaign=conquest&utm_content=junglescout-alt",
    "competitor-analysis": "https://www.voc.ai/features/competitor-analysis?utm_source=google&utm_medium=cpc&utm_campaign=category&utm_content=competitor-analysis",
    "ai-for-sellers": "https://www.voc.ai/?utm_source=google&utm_medium=cpc&utm_campaign=category&utm_content=ai-for-sellers#agent",
    "review-pain": "https://www.voc.ai/product/voice-of-customer-analysis?utm_source=google&utm_medium=cpc&utm_campaign=category-us&utm_content=review-pain",
    "voc-analysis": "https://www.voc.ai/product/voice-of-customer-analysis?utm_source=google&utm_medium=cpc&utm_campaign=category&utm_content=voc-analysis",
}


def load_client() -> GoogleAdsClient:
    env_path = os.environ.get(
        "GOOGLE_ADS_ENV", os.path.expanduser("~/.config/gtm-swarm/google-ads.env")
    )
    config: dict[str, str] = {}
    with open(env_path, encoding="utf-8") as handle:
        for line in handle:
            match = re.match(r"([A-Z_]+)=(.*)", line.strip())
            if match:
                config[match.group(1)] = match.group(2).strip().strip("\"'")
    return GoogleAdsClient.load_from_dict(
        {
            "developer_token": config.get("GOOGLE_ADS_DEVELOPER_TOKEN") or config["DEVELOPER_TOKEN"],
            "client_id": config.get("GOOGLE_ADS_CLIENT_ID") or config["CLIENT_ID"],
            "client_secret": config.get("GOOGLE_ADS_CLIENT_SECRET") or config["CLIENT_SECRET"],
            "refresh_token": config.get("GOOGLE_ADS_REFRESH_TOKEN") or config["REFRESH_TOKEN"],
            "login_customer_id": LOGIN_CID,
            "use_proto_plus": True,
        }
    )


def main() -> None:
    if os.environ.get("ADS_MUTATION_APPROVED") != "1":
        raise RuntimeError("mutation blocked: set ADS_MUTATION_APPROVED=1 after explicit approval")
    if not CID:
        raise RuntimeError("missing GOOGLE_ADS_CUSTOMER_ID")
    client = load_client()
    ga = client.get_service("GoogleAdsService")

    groups = {}
    group_rows = ga.search(
        customer_id=CID,
        query="""
          SELECT campaign.name, ad_group.id, ad_group.name, ad_group.resource_name, ad_group.status
          FROM ad_group
          WHERE campaign.name LIKE 'VOC-%' AND ad_group.status != 'REMOVED'
        """,
    )
    for row in group_rows:
        groups[row.ad_group.name] = {
            "id": row.ad_group.id,
            "resource_name": row.ad_group.resource_name,
            "status": row.ad_group.status.name,
            "campaign": row.campaign.name,
        }

    keyword_rows = ga.search(
        customer_id=CID,
        query="""
          SELECT ad_group.name, ad_group_criterion.resource_name,
                 ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
                 ad_group_criterion.status
          FROM keyword_view
          WHERE campaign.name LIKE 'VOC-%' AND ad_group_criterion.status != 'REMOVED'
        """,
    )
    existing_keywords = set()
    phrase_to_pause = []
    for row in keyword_rows:
        group = row.ad_group.name
        criterion = row.ad_group_criterion
        key = (group, criterion.keyword.text.lower(), criterion.keyword.match_type.name)
        existing_keywords.add(key)
        if (
            criterion.status.name == "ENABLED"
            and criterion.keyword.match_type.name == "PHRASE"
            and criterion.keyword.text.lower() in PAUSE_PHRASE_KEYWORDS.get(group, set())
        ):
            phrase_to_pause.append(criterion.resource_name)

    # 1) Pause low-intent review-pain group.
    ad_group_ops = []
    if groups.get("review-pain", {}).get("status") != "PAUSED":
        op = client.get_type("AdGroupOperation")
        op.update.resource_name = groups["review-pain"]["resource_name"]
        op.update.status = client.enums.AdGroupStatusEnum.PAUSED
        op.update_mask.CopyFrom(protobuf_helpers.field_mask(None, op.update._pb))
        ad_group_ops.append(op)

    # 2) Add exact high-intent keywords and pause over-broad phrase keywords.
    criterion_ops = []
    for group, keywords in EXACT_KEYWORDS.items():
        for keyword in keywords:
            if (group, keyword.lower(), "EXACT") in existing_keywords:
                continue
            op = client.get_type("AdGroupCriterionOperation")
            op.create.ad_group = client.get_service("AdGroupService").ad_group_path(CID, groups[group]["id"])
            op.create.status = client.enums.AdGroupCriterionStatusEnum.ENABLED
            op.create.keyword.text = keyword
            op.create.keyword.match_type = client.enums.KeywordMatchTypeEnum.EXACT
            criterion_ops.append(op)
    for resource_name in phrase_to_pause:
        op = client.get_type("AdGroupCriterionOperation")
        op.update.resource_name = resource_name
        op.update.status = client.enums.AdGroupCriterionStatusEnum.PAUSED
        op.update_mask.CopyFrom(protobuf_helpers.field_mask(None, op.update._pb))
        criterion_ops.append(op)

    # 3) Add only missing campaign negatives.
    negative_rows = ga.search(
        customer_id=CID,
        query="""
          SELECT campaign.name, campaign_criterion.keyword.text,
                 campaign_criterion.keyword.match_type
          FROM campaign_criterion
          WHERE campaign.name LIKE 'VOC-%' AND campaign_criterion.type = 'KEYWORD'
            AND campaign_criterion.negative = TRUE
        """,
    )
    existing_negatives = {
        (row.campaign.name, row.campaign_criterion.keyword.text.lower(), row.campaign_criterion.keyword.match_type.name)
        for row in negative_rows
    }
    campaign_criterion_ops = []
    for campaign, values in NEGATIVES.items():
        for keyword, match_type in values:
            if (campaign, keyword.lower(), match_type) in existing_negatives:
                continue
            op = client.get_type("CampaignCriterionOperation")
            op.create.campaign = client.get_service("CampaignService").campaign_path(CID, CAMPAIGN_IDS[campaign])
            op.create.negative = True
            op.create.keyword.text = keyword
            op.create.keyword.match_type = getattr(client.enums.KeywordMatchTypeEnum, match_type)
            campaign_criterion_ops.append(op)

    # 4) Route each enabled/paused RSA to its matching landing page.
    ad_rows = ga.search(
        customer_id=CID,
        query="""
          SELECT ad_group.name, ad_group.resource_name,
                 ad_group_ad.resource_name, ad_group_ad.ad.final_urls,
                 ad_group_ad.ad.final_mobile_urls,
                 ad_group_ad.ad.responsive_search_ad.path1,
                 ad_group_ad.ad.responsive_search_ad.path2,
                 ad_group_ad.ad.responsive_search_ad.headlines,
                 ad_group_ad.ad.responsive_search_ad.descriptions,
                 ad_group_ad.status
          FROM ad_group_ad
          WHERE campaign.name LIKE 'VOC-%' AND ad_group_ad.status != 'REMOVED'
        """,
    )
    ad_ops = []
    for row in ad_rows:
        desired = FINAL_URLS.get(row.ad_group.name)
        if not desired or list(row.ad_group_ad.ad.final_urls) == [desired]:
            continue
        # Final URLs are immutable on an existing ad. Replace the RSA atomically
        # with the same creative and a new destination.
        remove_op = client.get_type("AdGroupAdOperation")
        remove_op.remove = row.ad_group_ad.resource_name
        ad_ops.append(remove_op)

        create_op = client.get_type("AdGroupAdOperation")
        replacement = create_op.create
        replacement.ad_group = row.ad_group.resource_name
        replacement.status = row.ad_group_ad.status
        replacement.ad.final_urls.append(desired)
        replacement.ad.final_mobile_urls.extend(row.ad_group_ad.ad.final_mobile_urls)
        replacement.ad.responsive_search_ad.path1 = row.ad_group_ad.ad.responsive_search_ad.path1
        replacement.ad.responsive_search_ad.path2 = row.ad_group_ad.ad.responsive_search_ad.path2
        for old_asset in row.ad_group_ad.ad.responsive_search_ad.headlines:
            asset = client.get_type("AdTextAsset")
            asset.text = old_asset.text
            asset.pinned_field = old_asset.pinned_field
            replacement.ad.responsive_search_ad.headlines.append(asset)
        for old_asset in row.ad_group_ad.ad.responsive_search_ad.descriptions:
            asset = client.get_type("AdTextAsset")
            asset.text = old_asset.text
            asset.pinned_field = old_asset.pinned_field
            replacement.ad.responsive_search_ad.descriptions.append(asset)
        ad_ops.append(create_op)

    batches = [
        ("ad groups", client.get_service("AdGroupService").mutate_ad_groups, ad_group_ops),
        ("keywords", client.get_service("AdGroupCriterionService").mutate_ad_group_criteria, criterion_ops),
        ("negatives", client.get_service("CampaignCriterionService").mutate_campaign_criteria, campaign_criterion_ops),
        ("ads", client.get_service("AdGroupAdService").mutate_ad_group_ads, ad_ops),
    ]
    print("PLAN", {name: len(ops) for name, _, ops in batches})
    for name, mutate, ops in batches:
        if ops:
            mutate(request={"customer_id": CID, "operations": ops, "validate_only": True})
            print("VALIDATED", name, len(ops))
    for name, mutate, ops in batches:
        if ops:
            response = mutate(request={"customer_id": CID, "operations": ops})
            print("APPLIED", name, len(response.results))
    print("DONE")


if __name__ == "__main__":
    main()
