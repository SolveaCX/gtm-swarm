#!/usr/bin/env python3
"""Refocus VOC campaigns on MCP + Amazon data (user directive 2026-07-16).

1. New ad group 'amazon-data' in VOC-API-MCP-Dev-US with amazon data/review-data keywords + RSA
2. Add MCP keywords to existing 'mcp' ad group
3. Budget reallocation ($50/d total unchanged): Dev $5->$20, Conquest $25->$15, Category $15->$10
4. Dev CPC ceiling $4->$6 (0-impression fix), dev ad group bids -> $6

Usage: python3 focus_mcp_data.py [--dry-run]
"""
import os, re, sys
from google.api_core import protobuf_helpers

CID = os.environ.get("GOOGLE_ADS_CUSTOMER_ID", "")
LOGIN_CID = os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") or None
DEV = "VOC-API-MCP-Dev-US"

NEW_GROUP = "amazon-data"
NEW_GROUP_KWS = ["amazon review data", "amazon reviews data", "amazon product data",
                 "amazon data", "amazon review dataset", "ecommerce dataset"]
MCP_ADD_KWS = ["amazon mcp", "amazon mcp server", "ecommerce mcp", "mcp server for amazon"]

RSA = dict(
    h=["Amazon Review Data at Scale", "2B+ Amazon Reviews Indexed", "500M+ Products Tracked",
       "Amazon Data for AI Agents", "Reviews, Keywords, Sales Data", "REST, Python SDK, or MCP",
       "Get API Keys in Minutes", "Refreshed Daily", "Free to Start", "The E-commerce Data Layer"],
    d=["Every review, keyword & sales signal — built for your agent to consume. Get API keys.",
       "The e-commerce data layer for AI agents. 2B+ reviews indexed and refreshed daily.",
       "Reviews, keywords, sales estimates & listings via REST API, Python SDK, or MCP server.",
       "Drop e-commerce intelligence into Claude, Cursor, or your own agent. REST, SDK, or MCP."],
    p1="api", p2="amazon-data",
    url="https://www.voc.ai/?utm_source=google&utm_medium=cpc&utm_campaign=dev-us&utm_content=amazon-data")

BUDGETS = {DEV: 20.0, "VOC-Agent-Conquest-US": 15.0, "VOC-Agent-Category-US": 10.0}
DEV_CPC_CEILING = 6.0

def validate():
    errs = []
    for h in RSA["h"]:
        if len(h) > 30: errs.append(f"headline >30: {h!r} ({len(h)})")
    for d in RSA["d"]:
        if len(d) > 90: errs.append(f"description >90: {d!r} ({len(d)})")
    if errs:
        print("\n".join(errs)); sys.exit(1)
    print(f"validation OK: {len(NEW_GROUP_KWS)} + {len(MCP_ADD_KWS)} new keywords, RSA {len(RSA['h'])}H/{len(RSA['d'])}D")

def main():
    if os.environ.get("ADS_MUTATION_APPROVED") != "1":
        raise RuntimeError("mutation blocked: set ADS_MUTATION_APPROVED=1 after explicit approval")
    if not CID:
        raise RuntimeError("missing GOOGLE_ADS_CUSTOMER_ID")
    validate()
    if "--dry-run" in sys.argv: return
    from google.ads.googleads.client import GoogleAdsClient
    cfg = {}
    env_path = os.environ.get(
        "GOOGLE_ADS_ENV", os.path.expanduser("~/.config/gtm-swarm/google-ads.env")
    )
    for line in open(env_path):
        m = re.match(r"([A-Z_]+)=(.*)", line.strip())
        if m: cfg[m.group(1)] = m.group(2).strip().strip('"')
    client = GoogleAdsClient.load_from_dict({
        "developer_token": cfg["DEVELOPER_TOKEN"], "client_id": cfg["CLIENT_ID"],
        "client_secret": cfg["CLIENT_SECRET"], "refresh_token": cfg["REFRESH_TOKEN"],
        "login_customer_id": LOGIN_CID, "use_proto_plus": True})
    ga = client.get_service("GoogleAdsService")

    camps = {}
    for r in ga.search(customer_id=CID, query="""
        SELECT campaign.id, campaign.name, campaign_budget.resource_name
        FROM campaign WHERE campaign.name LIKE 'VOC-%' AND campaign.status != 'REMOVED'"""):
        camps[r.campaign.name] = {"rn": f"customers/{CID}/campaigns/{r.campaign.id}",
                                  "budget_rn": r.campaign_budget.resource_name}
    groups = {}
    for r in ga.search(customer_id=CID, query=f"""
        SELECT ad_group.id, ad_group.name FROM ad_group
        WHERE campaign.name = '{DEV}' AND ad_group.status != 'REMOVED'"""):
        groups[r.ad_group.name] = f"customers/{CID}/adGroups/{r.ad_group.id}"

    # 1) budgets
    bsvc = client.get_service("CampaignBudgetService")
    bops = []
    for name, amount in BUDGETS.items():
        op = client.get_type("CampaignBudgetOperation")
        op.update.resource_name = camps[name]["budget_rn"]
        op.update.amount_micros = int(amount * 1_000_000)
        client.copy_from(op.update_mask, protobuf_helpers.field_mask(None, op.update._pb))
        bops.append(op)
    bsvc.mutate_campaign_budgets(customer_id=CID, operations=bops)
    print(f"budgets updated: {BUDGETS}")

    # 2) dev campaign CPC ceiling
    csvc = client.get_service("CampaignService")
    cop = client.get_type("CampaignOperation")
    cop.update.resource_name = camps[DEV]["rn"]
    cop.update.target_spend.cpc_bid_ceiling_micros = int(DEV_CPC_CEILING * 1_000_000)
    client.copy_from(cop.update_mask, protobuf_helpers.field_mask(None, cop.update._pb))
    csvc.mutate_campaigns(customer_id=CID, operations=[cop])
    print(f"{DEV} cpc ceiling -> ${DEV_CPC_CEILING}")

    # 3) raise existing dev ad group bids
    agsvc = client.get_service("AdGroupService")
    agops = []
    for name, rn in groups.items():
        op = client.get_type("AdGroupOperation")
        op.update.resource_name = rn
        op.update.cpc_bid_micros = int(DEV_CPC_CEILING * 1_000_000)
        client.copy_from(op.update_mask, protobuf_helpers.field_mask(None, op.update._pb))
        agops.append(op)
    if agops:
        agsvc.mutate_ad_groups(customer_id=CID, operations=agops)
        print(f"dev ad group bids -> ${DEV_CPC_CEILING} ({', '.join(groups)})")

    agcsvc = client.get_service("AdGroupCriterionService")

    # 4) new amazon-data ad group + keywords + RSA
    if NEW_GROUP not in groups:
        agop = client.get_type("AdGroupOperation")
        ag = agop.create
        ag.name = NEW_GROUP
        ag.campaign = camps[DEV]["rn"]
        ag.type_ = client.enums.AdGroupTypeEnum.SEARCH_STANDARD
        ag.status = client.enums.AdGroupStatusEnum.ENABLED
        ag.cpc_bid_micros = int(DEV_CPC_CEILING * 1_000_000)
        res = agsvc.mutate_ad_groups(customer_id=CID, operations=[agop])
        groups[NEW_GROUP] = res.results[0].resource_name
        print(f"created ad group {NEW_GROUP}")

        kw_ops = []
        for kw in NEW_GROUP_KWS:
            k = client.get_type("AdGroupCriterionOperation")
            k.create.ad_group = groups[NEW_GROUP]
            k.create.status = client.enums.AdGroupCriterionStatusEnum.ENABLED
            k.create.keyword.text = kw
            k.create.keyword.match_type = client.enums.KeywordMatchTypeEnum.PHRASE
            kw_ops.append(k)
        agcsvc.mutate_ad_group_criteria(customer_id=CID, operations=kw_ops)
        print(f"  +{len(NEW_GROUP_KWS)} keywords")

        adsvc = client.get_service("AdGroupAdService")
        adop = client.get_type("AdGroupAdOperation")
        ada = adop.create
        ada.ad_group = groups[NEW_GROUP]
        ada.status = client.enums.AdGroupAdStatusEnum.ENABLED
        ada.ad.final_urls.append(RSA["url"])
        for h in RSA["h"]:
            a = client.get_type("AdTextAsset"); a.text = h
            ada.ad.responsive_search_ad.headlines.append(a)
        for d in RSA["d"]:
            a = client.get_type("AdTextAsset"); a.text = d
            ada.ad.responsive_search_ad.descriptions.append(a)
        ada.ad.responsive_search_ad.path1 = RSA["p1"]
        ada.ad.responsive_search_ad.path2 = RSA["p2"]
        adsvc.mutate_ad_group_ads(customer_id=CID, operations=[adop])
        print("  +RSA (enters review)")

    # 5) extra MCP keywords into existing mcp group
    existing = set()
    for r in ga.search(customer_id=CID, query=f"""
        SELECT ad_group_criterion.keyword.text FROM ad_group_criterion
        WHERE campaign.name = '{DEV}' AND ad_group_criterion.type = 'KEYWORD'
          AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status != 'REMOVED'"""):
        existing.add(r.ad_group_criterion.keyword.text)
    kw_ops = []
    for kw in MCP_ADD_KWS:
        if kw in existing: continue
        k = client.get_type("AdGroupCriterionOperation")
        k.create.ad_group = groups["mcp"]
        k.create.status = client.enums.AdGroupCriterionStatusEnum.ENABLED
        k.create.keyword.text = kw
        k.create.keyword.match_type = client.enums.KeywordMatchTypeEnum.PHRASE
        kw_ops.append(k)
    if kw_ops:
        agcsvc.mutate_ad_group_criteria(customer_id=CID, operations=kw_ops)
        print(f"mcp group +{len(kw_ops)} keywords")
    print("DONE — 重点已切到 MCP + Amazon data")

if __name__ == "__main__":
    main()
