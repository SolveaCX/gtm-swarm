#!/usr/bin/env python3
"""Apply and verify the 2026-07-31 Flatkey Google Ads stop-loss plan.

The mutation is deliberately narrow and idempotent:
* cap the isolated US Tools test at USD 10/day;
* keep the legacy US token campaign and DE campaign paused;
* pause the duplicate Tools API & GTM Data group in the legacy US campaign;
* remove the stale chatgpt-api-alternative UTM suffix from legacy US;
* keep PT to the single PT-Core traffic cell.

Usage:
  python optimize_flatkey_20260731.py
  ADS_MUTATION_APPROVED=1 python optimize_flatkey_20260731.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re


CUSTOMER_ID = "2752299046"
LOGIN_CUSTOMER_ID = "7153662160"
TOOLS_CAMPAIGN = "flatkey-US-Tools-Landing-Test"
US_TOKEN_CAMPAIGN = "flatkey-US-Search"
DE_CAMPAIGN = "flatkey-DE-Search"
PT_CAMPAIGN = "flatkey-PT-Search"
DUPLICATE_TOOLS_GROUP = "Tools API & GTM Data"
PT_ACTIVE_GROUP = "PT-Core"
TOOLS_BUDGET_USD = 10.0
SAFE_VALUE_TRACK_SUFFIX = (
    "campaign_id={campaignid}&ad_group_id={adgroupid}&creative_id={creative}"
    "&keyword={keyword}&match_type={matchtype}&network={network}&device={device}"
    "&location_id={loc_physical_ms}"
)


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
    path = next(
        (
            os.path.expanduser(value)
            for value in candidates
            if value and os.path.exists(os.path.expanduser(value))
        ),
        None,
    )
    if not path:
        raise RuntimeError("Google Ads config file was not found")
    config = load_config(path)
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
    missing = [key for key, value in values.items() if value in (None, "")]
    if missing:
        raise RuntimeError(f"missing Google Ads config: {', '.join(missing)}")
    return GoogleAdsClient.load_from_dict(values)


def state(client) -> dict[str, object]:
    ga = client.get_service("GoogleAdsService")
    names = ", ".join(
        f"'{name}'"
        for name in (TOOLS_CAMPAIGN, US_TOKEN_CAMPAIGN, DE_CAMPAIGN, PT_CAMPAIGN)
    )
    campaigns: dict[str, dict[str, object]] = {}
    for row in ga.search(
        customer_id=CUSTOMER_ID,
        query=f"""
          SELECT campaign.id, campaign.name, campaign.resource_name, campaign.status,
                 campaign.final_url_suffix, campaign_budget.resource_name,
                 campaign_budget.amount_micros, campaign_budget.explicitly_shared
          FROM campaign
          WHERE campaign.name IN ({names}) AND campaign.status != 'REMOVED'
        """,
    ):
        campaigns[row.campaign.name] = {
            "id": str(row.campaign.id),
            "resource_name": row.campaign.resource_name,
            "status": row.campaign.status.name,
            "final_url_suffix": row.campaign.final_url_suffix,
            "budget_resource": row.campaign_budget.resource_name,
            "budget_usd": row.campaign_budget.amount_micros / 1_000_000,
            "budget_shared": bool(row.campaign_budget.explicitly_shared),
        }
    if set(campaigns) != {
        TOOLS_CAMPAIGN,
        US_TOKEN_CAMPAIGN,
        DE_CAMPAIGN,
        PT_CAMPAIGN,
    }:
        raise RuntimeError("one or more named campaigns are missing")

    groups: list[dict[str, str]] = []
    for row in ga.search(
        customer_id=CUSTOMER_ID,
        query=f"""
          SELECT campaign.name, ad_group.name, ad_group.resource_name, ad_group.status
          FROM ad_group
          WHERE campaign.name IN ('{US_TOKEN_CAMPAIGN}', '{PT_CAMPAIGN}')
            AND ad_group.status != 'REMOVED'
        """,
    ):
        groups.append(
            {
                "campaign": row.campaign.name,
                "name": row.ad_group.name,
                "resource_name": row.ad_group.resource_name,
                "status": row.ad_group.status.name,
            }
        )
    return {"campaigns": campaigns, "groups": groups}


def apply(client, before: dict[str, object]) -> None:
    campaigns = before["campaigns"]
    budget = campaigns[TOOLS_CAMPAIGN]
    if budget["budget_shared"]:
        raise RuntimeError("Tools campaign budget unexpectedly became shared")
    if float(budget["budget_usd"]) != TOOLS_BUDGET_USD:
        operation = client.get_type("CampaignBudgetOperation")
        operation.update.resource_name = budget["budget_resource"]
        operation.update.amount_micros = int(TOOLS_BUDGET_USD * 1_000_000)
        operation.update_mask.paths.append("amount_micros")
        client.get_service("CampaignBudgetService").mutate_campaign_budgets(
            customer_id=CUSTOMER_ID, operations=[operation]
        )

    campaign_operations = []
    for name in (US_TOKEN_CAMPAIGN, DE_CAMPAIGN):
        campaign = campaigns[name]
        if campaign["status"] == "PAUSED":
            continue
        operation = client.get_type("CampaignOperation")
        operation.update.resource_name = campaign["resource_name"]
        operation.update.status = client.enums.CampaignStatusEnum.PAUSED
        operation.update_mask.paths.append("status")
        campaign_operations.append(operation)

    us_campaign = campaigns[US_TOKEN_CAMPAIGN]
    if us_campaign["final_url_suffix"] != SAFE_VALUE_TRACK_SUFFIX:
        operation = client.get_type("CampaignOperation")
        operation.update.resource_name = us_campaign["resource_name"]
        operation.update.final_url_suffix = SAFE_VALUE_TRACK_SUFFIX
        operation.update_mask.paths.append("final_url_suffix")
        campaign_operations.append(operation)
    if campaign_operations:
        client.get_service("CampaignService").mutate_campaigns(
            customer_id=CUSTOMER_ID, operations=campaign_operations
        )

    group_operations = []
    for group in before["groups"]:
        should_pause = (
            group["campaign"] == US_TOKEN_CAMPAIGN
            and group["name"] == DUPLICATE_TOOLS_GROUP
        ) or (
            group["campaign"] == PT_CAMPAIGN and group["name"] != PT_ACTIVE_GROUP
        )
        if not should_pause or group["status"] == "PAUSED":
            continue
        operation = client.get_type("AdGroupOperation")
        operation.update.resource_name = group["resource_name"]
        operation.update.status = client.enums.AdGroupStatusEnum.PAUSED
        operation.update_mask.paths.append("status")
        group_operations.append(operation)
    if group_operations:
        client.get_service("AdGroupService").mutate_ad_groups(
            customer_id=CUSTOMER_ID, operations=group_operations
        )


def verify(current: dict[str, object]) -> None:
    campaigns = current["campaigns"]
    tools = campaigns[TOOLS_CAMPAIGN]
    if tools["budget_shared"] or float(tools["budget_usd"]) != TOOLS_BUDGET_USD:
        raise RuntimeError("Tools budget was not capped at USD 10/day")
    for name in (US_TOKEN_CAMPAIGN, DE_CAMPAIGN):
        if campaigns[name]["status"] != "PAUSED":
            raise RuntimeError(f"{name} is not paused")
    if campaigns[US_TOKEN_CAMPAIGN]["final_url_suffix"] != SAFE_VALUE_TRACK_SUFFIX:
        raise RuntimeError("legacy US attribution suffix is still polluted")
    for group in current["groups"]:
        if (
            group["campaign"] == US_TOKEN_CAMPAIGN
            and group["name"] == DUPLICATE_TOOLS_GROUP
            and group["status"] != "PAUSED"
        ):
            raise RuntimeError("duplicate legacy Tools group is not paused")
        if (
            group["campaign"] == PT_CAMPAIGN
            and group["name"] != PT_ACTIVE_GROUP
            and group["status"] != "PAUSED"
        ):
            raise RuntimeError("PT has more than one active traffic cell")


def compact(value: dict[str, object]) -> dict[str, object]:
    return {
        "campaigns": {
            name: {
                "status": item["status"],
                "budget_usd": item["budget_usd"],
                "budget_shared": item["budget_shared"],
                "final_url_suffix": item["final_url_suffix"],
            }
            for name, item in value["campaigns"].items()
        },
        "groups": [
            {key: group[key] for key in ("campaign", "name", "status")}
            for group in value["groups"]
            if group["campaign"] == PT_CAMPAIGN
            or group["name"] == DUPLICATE_TOOLS_GROUP
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    client = google_client()
    before = state(client)
    if not args.apply:
        print(json.dumps({"mode": "dry-run", "before": compact(before)}, indent=2))
        return
    if os.environ.get("ADS_MUTATION_APPROVED") != "1":
        raise RuntimeError("mutation blocked: set ADS_MUTATION_APPROVED=1")
    apply(client, before)
    after = state(client)
    verify(after)
    print(
        json.dumps(
            {"mode": "applied-and-verified", "before": compact(before), "after": compact(after)},
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
