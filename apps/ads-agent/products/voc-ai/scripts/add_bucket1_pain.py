#!/usr/bin/env python3
"""Add Bucket-1 paid keywords from the CEO SEO/keyword strategy doc (2026-07-16).

Doc: VOC-ai-SEO-Keyword-Analysis (Google Docs 11r7-zz_...)
- New ad group 'review-pain' in VOC-Agent-Category-US:
    how to get more reviews on amazon / remove|get rid of negative reviews /
    amazon review checker / how to fix negative reviews  + pain-angle RSA
- Add bare phrase 'amazon review analysis' (doc: cheap, perfectly qualified)
  to Conquest/review-tools group.
No budget changes (user's MCP+amazon-data priority from earlier today stands).
"""
import os, re, sys

CID = os.environ.get("GOOGLE_ADS_CUSTOMER_ID", "")
LOGIN_CID = os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") or None
CAT = "VOC-Agent-Category-US"
CONQ = "VOC-Agent-Conquest-US"

PAIN_GROUP = "review-pain"
PAIN_KWS = ["how to get more reviews on amazon",
            "how to remove negative reviews on amazon",
            "how to get rid of negative reviews on amazon",
            "amazon review checker",
            "how to fix negative reviews"]
EXTRA = {("review-tools", CONQ): ["amazon review analysis"]}

RSA = dict(
    h=["Get More 5-Star Reviews", "Know What Drives 5 Stars", "Amazon Review Checker",
       "Flag Policy-Breaking Reviews", "Review Alerts for Sellers", "2B+ Amazon Reviews Indexed",
       "Insights in 60 Seconds", "Free for Individual Sellers", "Trusted by Sellers Since 2020",
       "Paste an ASIN. Get Answers"],
    d=["Know what drives 5-star reviews before you ask for them. Analyze any ASIN in 60 seconds.",
       "Review alerts flag policy-violating reviews automatically. Monitor your ASINs daily.",
       "Turn competitor complaints into your next product. 2B+ Amazon reviews, refreshed daily.",
       "Paste an ASIN. Get customer insights in 60 seconds. Trusted by 100K+ sellers."],
    p1="agent", p2="reviews",
    url="https://www.voc.ai/?utm_source=google&utm_medium=cpc&utm_campaign=category-us&utm_content=review-pain")

def main():
    if os.environ.get("ADS_MUTATION_APPROVED") != "1":
        raise RuntimeError("mutation blocked: set ADS_MUTATION_APPROVED=1 after explicit approval")
    if not CID:
        raise RuntimeError("missing GOOGLE_ADS_CUSTOMER_ID")
    for h in RSA["h"]:
        assert len(h) <= 30, h
    for d in RSA["d"]:
        assert len(d) <= 90, d
    print("validation OK")
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

    camps, groups, existing_kws = {}, {}, set()
    for r in ga.search(customer_id=CID, query="""
        SELECT campaign.id, campaign.name FROM campaign
        WHERE campaign.name LIKE 'VOC-%' AND campaign.status != 'REMOVED'"""):
        camps[r.campaign.name] = f"customers/{CID}/campaigns/{r.campaign.id}"
    for r in ga.search(customer_id=CID, query="""
        SELECT ad_group.id, ad_group.name, campaign.name FROM ad_group
        WHERE campaign.name LIKE 'VOC-%' AND ad_group.status != 'REMOVED'"""):
        groups[(r.ad_group.name, r.campaign.name)] = f"customers/{CID}/adGroups/{r.ad_group.id}"
    for r in ga.search(customer_id=CID, query="""
        SELECT ad_group_criterion.keyword.text FROM ad_group_criterion
        WHERE campaign.name LIKE 'VOC-%' AND ad_group_criterion.type = 'KEYWORD'
          AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status != 'REMOVED'"""):
        existing_kws.add(r.ad_group_criterion.keyword.text)

    agsvc = client.get_service("AdGroupService")
    agcsvc = client.get_service("AdGroupCriterionService")
    adsvc = client.get_service("AdGroupAdService")

    if (PAIN_GROUP, CAT) not in groups:
        agop = client.get_type("AdGroupOperation")
        ag = agop.create
        ag.name = PAIN_GROUP
        ag.campaign = camps[CAT]
        ag.type_ = client.enums.AdGroupTypeEnum.SEARCH_STANDARD
        ag.status = client.enums.AdGroupStatusEnum.ENABLED
        ag.cpc_bid_micros = 5_000_000
        res = agsvc.mutate_ad_groups(customer_id=CID, operations=[agop])
        groups[(PAIN_GROUP, CAT)] = res.results[0].resource_name
        print(f"created ad group {PAIN_GROUP} in {CAT}")

        ops = []
        for kw in PAIN_KWS:
            k = client.get_type("AdGroupCriterionOperation")
            k.create.ad_group = groups[(PAIN_GROUP, CAT)]
            k.create.status = client.enums.AdGroupCriterionStatusEnum.ENABLED
            k.create.keyword.text = kw
            k.create.keyword.match_type = client.enums.KeywordMatchTypeEnum.PHRASE
            ops.append(k)
        agcsvc.mutate_ad_group_criteria(customer_id=CID, operations=ops)
        print(f"  +{len(PAIN_KWS)} pain keywords")

        adop = client.get_type("AdGroupAdOperation")
        ada = adop.create
        ada.ad_group = groups[(PAIN_GROUP, CAT)]
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

    ops = []
    for (grp, camp), kws in EXTRA.items():
        for kw in kws:
            if kw in existing_kws: continue
            k = client.get_type("AdGroupCriterionOperation")
            k.create.ad_group = groups[(grp, camp)]
            k.create.status = client.enums.AdGroupCriterionStatusEnum.ENABLED
            k.create.keyword.text = kw
            k.create.keyword.match_type = client.enums.KeywordMatchTypeEnum.PHRASE
            ops.append(k)
    if ops:
        agcsvc.mutate_ad_group_criteria(customer_id=CID, operations=ops)
        print(f"+{len(ops)} extra keywords (amazon review analysis)")
    print("DONE — Bucket 1 live")

if __name__ == "__main__":
    main()
