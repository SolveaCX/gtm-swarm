#!/usr/bin/env python3
"""Create VOC AI Agent campaigns in Google Ads (CID 2752299046).

Self-contained: campaign/adgroup/keyword/RSA data inlined.
Applies all learnings from flatkey campaigns (see ads-playbook skill):
  - geo presence-only (not presence-or-interest)
  - explicit CPC ceiling on Maximize Clicks (default $0.01 trap)
  - EU political advertising declaration (new API requirement)
  - PHRASE match, campaign-level negatives, campaigns created PAUSED

Usage (with GOOGLE_ADS_ENV pointing to a secret file outside Git):
  grpc_proxy=127.0.0.1:7890 python3 create_voc_campaigns.py [--enable]
  --enable : flip campaigns to ENABLED after creation (default leaves PAUSED)
"""
import sys, os, re

CID = os.environ.get("GOOGLE_ADS_CUSTOMER_ID", "")
LOGIN_CID = os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") or None

# ---------- data ----------
CAMPAIGNS = {
    "VOC-Agent-Conquest-US": {"budget": 40.0, "cpc_ceiling": 5.0},
    "VOC-Agent-Category-US": {"budget": 40.0, "cpc_ceiling": 5.0},
    "VOC-API-MCP-Dev-US":    {"budget": 20.0, "cpc_ceiling": 4.0},
    "VOC-Brand-Defense":     {"budget": 5.0,  "cpc_ceiling": 2.0},
}

ADGROUPS = {  # campaign -> {adgroup: [keywords]}
    "VOC-Agent-Conquest-US": {
        "helium10-alt": ["helium 10 alternative", "helium 10 alternatives", "helium 10 vs", "cheaper than helium 10"],
        "junglescout-alt": ["jungle scout alternative", "jungle scout alternatives", "jungle scout vs helium 10"],
        "review-tools": ["amazon review analysis tool", "amazon review analyzer", "amazon review analysis software", "review analysis ai"],
    },
    "VOC-Agent-Category-US": {
        "voc-analysis": ["voice of customer analysis", "voice of customer tool", "customer feedback analysis ai", "analyze amazon reviews"],
        "competitor-analysis": ["amazon competitor analysis tool", "amazon competitor research", "competitor review analysis"],
        "ai-for-sellers": ["ai for amazon sellers", "amazon seller ai tools", "ai product research amazon", "ecommerce ai agent", "ai agent for ecommerce"],
    },
    "VOC-API-MCP-Dev-US": {
        "data-api": ["amazon reviews api", "amazon product data api", "ecommerce data api", "amazon product review dataset", "amazon keyword data api"],
        "mcp": ["ecommerce mcp server", "amazon data mcp", "mcp server for ecommerce data"],
    },
    "VOC-Brand-Defense": {
        "brand": ["voc ai", "voc.ai", "vocai", "shulex voc"],
    },
}

NEGATIVES = {
    "VOC-Agent-Conquest-US": ["free download", "crack", "coupon", "jobs", "salary", "course", "tutorial"],
    "VOC-Agent-Category-US": ["free download", "jobs", "salary", "course", "what is voice of customer"],
    "VOC-API-MCP-Dev-US": ["free", "scraper tutorial", "jobs"],
    "VOC-Brand-Defense": [],
}

H_COMMON = ["Amazon Review AI Agent", "Insights in 60 Seconds", "2B+ Amazon Reviews Indexed",
            "Free for Individual Sellers", "2,000 Free Credits to Start", "No SQL. No Dashboards.",
            "Trusted by Sellers Since 2020"]
D_SELLER = ["Keyword tools don't read what buyers complain about. VOC AI does. Free to start.",
            "Turn competitor complaints into your next product. 2B+ Amazon reviews, refreshed daily.",
            "Paste an ASIN. Get customer insights in 60 seconds. Trusted by 100K+ sellers.",
            "Ask anything about e-commerce performance. Answers in seconds with charts & tables."]
D_DEV = ["Drop e-commerce intelligence into Claude, Cursor, or your own agent. REST, SDK, or MCP.",
         "Every review, keyword & sales signal — built for your agent to consume. Get API keys.",
         "Reviews, keywords, sales estimates & listings via REST API, Python SDK, or MCP server.",
         "The e-commerce data layer for AI agents. 2B+ reviews indexed and refreshed daily."]

def _u(camp, content):
    slug = camp.replace("VOC-Agent-", "").replace("VOC-", "").replace("-US", "").lower()
    return (f"https://www.voc.ai/?utm_source=google&utm_medium=cpc"
            f"&utm_campaign={slug}&utm_content={content}")

RSAS = {  # (campaign, adgroup) -> dict(h=headlines, d=descriptions, p1, p2, url)
    ("VOC-Agent-Conquest-US", "helium10-alt"): dict(
        h=["Helium 10 Alternative", "Beyond Keyword Research Tools", "See What Buyers Complain About"] + H_COMMON,
        d=D_SELLER, p1="agent", p2="helium10-alt", url=_u("VOC-Agent-Conquest-US", "helium10-alt")),
    ("VOC-Agent-Conquest-US", "junglescout-alt"): dict(
        h=["Jungle Scout Alternative", "Beyond Keyword Research Tools", "Competitor Gaps in Minutes"] + H_COMMON,
        d=D_SELLER, p1="agent", p2="junglescout-alt", url=_u("VOC-Agent-Conquest-US", "junglescout-alt")),
    ("VOC-Agent-Conquest-US", "review-tools"): dict(
        h=["Amazon Review Analysis AI", "Paste an ASIN. Get Answers", "See What Buyers Complain About"] + H_COMMON,
        d=D_SELLER, p1="agent", p2="review-analysis", url=_u("VOC-Agent-Conquest-US", "review-tools")),
    ("VOC-Agent-Category-US", "voc-analysis"): dict(
        h=["Voice of Customer AI Agent", "Analyze Reviews in 60 Seconds", "Ask Anything. Get Charts."] + H_COMMON[:6],
        d=D_SELLER, p1="agent", p2="voc-analysis", url=_u("VOC-Agent-Category-US", "voc-analysis")),
    ("VOC-Agent-Category-US", "competitor-analysis"): dict(
        h=["Amazon Competitor Analysis AI", "Competitor Gaps in Minutes", "See What Buyers Complain About"] + H_COMMON[:6],
        d=D_SELLER, p1="agent", p2="competitor", url=_u("VOC-Agent-Category-US", "competitor-analysis")),
    ("VOC-Agent-Category-US", "ai-for-sellers"): dict(
        h=["AI Agent for Amazon Sellers", "Ask Anything. Get Charts.", "Paste an ASIN. Get Answers"] + H_COMMON[:6],
        d=D_SELLER, p1="agent", p2="for-sellers", url=_u("VOC-Agent-Category-US", "ai-for-sellers")),
    ("VOC-API-MCP-Dev-US", "data-api"): dict(
        h=["E-commerce Data API & MCP", "Amazon Reviews API", "Reviews, Keywords, Sales API",
           "REST, Python SDK, or MCP", "Works With Claude & Cursor", "Get API Keys in Minutes",
           "2B+ Amazon Reviews Indexed", "500M+ Products Tracked", "Built for AI Agents", "Free to Start"],
        d=D_DEV, p1="api", p2="docs", url=_u("VOC-API-MCP-Dev-US", "data-api")),
    ("VOC-API-MCP-Dev-US", "mcp"): dict(
        h=["E-commerce MCP Server", "Amazon Data for AI Agents", "Works With Claude & Cursor",
           "REST, Python SDK, or MCP", "Get API Keys in Minutes", "2B+ Amazon Reviews Indexed",
           "500M+ Products Tracked", "Built for AI Agents", "Free to Start"],
        d=D_DEV, p1="api", p2="mcp", url=_u("VOC-API-MCP-Dev-US", "mcp")),
    ("VOC-Brand-Defense", "brand"): dict(
        h=["VOC AI — Official Site", "Paste an ASIN. Get Answers", "Ask Anything. Get Charts."] + H_COMMON[:6],
        d=D_SELLER, p1="agent", p2="official", url=_u("VOC-Brand-Defense", "brand")),
}

# ---------- validation (fail fast before any API call) ----------
def validate():
    errs = []
    for k, r in RSAS.items():
        for h in r["h"]:
            if len(h) > 30: errs.append(f"{k} headline >30: {h!r} ({len(h)})")
        for d in r["d"]:
            if len(d) > 90: errs.append(f"{k} description >90: {d!r} ({len(d)})")
        if not (3 <= len(r["h"]) <= 15): errs.append(f"{k}: {len(r['h'])} headlines")
        if not (2 <= len(r["d"]) <= 4): errs.append(f"{k}: {len(r['d'])} descriptions")
        if len(set(r["h"])) != len(r["h"]): errs.append(f"{k}: duplicate headlines")
        for p in (r["p1"], r["p2"]):
            if len(p) > 15: errs.append(f"{k} path >15: {p!r}")
    for c in ADGROUPS:
        if c not in CAMPAIGNS: errs.append(f"adgroup campaign missing: {c}")
    if errs:
        print("VALIDATION FAILED:"); [print(" -", e) for e in errs]; sys.exit(1)
    print(f"validation OK: {len(CAMPAIGNS)} campaigns, "
          f"{sum(len(v) for v in ADGROUPS.values())} ad groups, "
          f"{sum(len(kw) for v in ADGROUPS.values() for kw in v.values())} keywords, {len(RSAS)} RSAs")

# ---------- creation ----------
def main():
    if os.environ.get("ADS_MUTATION_APPROVED") != "1":
        raise RuntimeError("mutation blocked: set ADS_MUTATION_APPROVED=1 after explicit approval")
    if not CID:
        raise RuntimeError("missing GOOGLE_ADS_CUSTOMER_ID")
    validate()
    if "--dry-run" in sys.argv:
        return
    from google.ads.googleads.client import GoogleAdsClient
    env = os.environ.get(
        "GOOGLE_ADS_ENV", os.path.expanduser("~/.config/gtm-swarm/google-ads.env")
    )
    cfg = {}
    for line in open(env):
        m = re.match(r"([A-Z_]+)=(.*)", line.strip())
        if m: cfg[m.group(1)] = m.group(2).strip().strip('"')
    client = GoogleAdsClient.load_from_dict({
        "developer_token": cfg["DEVELOPER_TOKEN"],
        "client_id": cfg["CLIENT_ID"],
        "client_secret": cfg["CLIENT_SECRET"],
        "refresh_token": cfg["REFRESH_TOKEN"],
        "login_customer_id": LOGIN_CID,
        "use_proto_plus": True,
    })
    created = {}

    budget_svc = client.get_service("CampaignBudgetService")
    camp_svc = client.get_service("CampaignService")
    crit_svc = client.get_service("CampaignCriterionService")
    ag_svc = client.get_service("AdGroupService")
    agc_svc = client.get_service("AdGroupCriterionService")
    ad_svc = client.get_service("AdGroupAdService")

    for name, conf in CAMPAIGNS.items():
        # budget (independent, not shared)
        bop = client.get_type("CampaignBudgetOperation")
        b = bop.create
        b.name = f"{name}-budget"
        b.amount_micros = int(conf["budget"] * 1_000_000)
        b.explicitly_shared = False
        b.delivery_method = client.enums.BudgetDeliveryMethodEnum.STANDARD
        bres = budget_svc.mutate_campaign_budgets(customer_id=CID, operations=[bop])
        budget_rn = bres.results[0].resource_name

        cop = client.get_type("CampaignOperation")
        c = cop.create
        c.name = name
        c.status = client.enums.CampaignStatusEnum.PAUSED
        c.advertising_channel_type = client.enums.AdvertisingChannelTypeEnum.SEARCH
        c.campaign_budget = budget_rn
        c.network_settings.target_google_search = True
        c.network_settings.target_search_network = False
        c.network_settings.target_content_network = False
        c.network_settings.target_partner_search_network = False
        c.geo_target_type_setting.positive_geo_target_type = \
            client.enums.PositiveGeoTargetTypeEnum.PRESENCE  # playbook: presence only
        c.target_spend.cpc_bid_ceiling_micros = int(conf["cpc_ceiling"] * 1_000_000)  # $0.01 trap
        try:  # new API mandates EU political declaration
            c.contains_eu_political_advertising = \
                client.enums.EuPoliticalAdvertisingStatusEnum.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING
        except Exception:
            pass
        cres = camp_svc.mutate_campaigns(customer_id=CID, operations=[cop])
        camp_rn = cres.results[0].resource_name
        created[name] = camp_rn
        print(f"campaign {name}: {camp_rn}")

        # geo US + language en + negatives
        ops = []
        geo = client.get_type("CampaignCriterionOperation")
        geo.create.campaign = camp_rn
        geo.create.location.geo_target_constant = "geoTargetConstants/2840"
        ops.append(geo)
        lang = client.get_type("CampaignCriterionOperation")
        lang.create.campaign = camp_rn
        lang.create.language.language_constant = "languageConstants/1000"
        ops.append(lang)
        for neg in NEGATIVES.get(name, []):
            n = client.get_type("CampaignCriterionOperation")
            n.create.campaign = camp_rn
            n.create.negative = True
            n.create.keyword.text = neg
            n.create.keyword.match_type = client.enums.KeywordMatchTypeEnum.BROAD
            ops.append(n)
        crit_svc.mutate_campaign_criteria(customer_id=CID, operations=ops)

        for ag_name, kws in ADGROUPS[name].items():
            agop = client.get_type("AdGroupOperation")
            ag = agop.create
            ag.name = ag_name
            ag.campaign = camp_rn
            ag.type_ = client.enums.AdGroupTypeEnum.SEARCH_STANDARD
            ag.status = client.enums.AdGroupStatusEnum.ENABLED
            ag.cpc_bid_micros = int(conf["cpc_ceiling"] * 1_000_000)  # explicit, never default
            agres = ag_svc.mutate_ad_groups(customer_id=CID, operations=[agop])
            ag_rn = agres.results[0].resource_name

            kw_ops = []
            for kw in kws:
                k = client.get_type("AdGroupCriterionOperation")
                k.create.ad_group = ag_rn
                k.create.status = client.enums.AdGroupCriterionStatusEnum.ENABLED
                k.create.keyword.text = kw
                k.create.keyword.match_type = client.enums.KeywordMatchTypeEnum.PHRASE
                kw_ops.append(k)
            agc_svc.mutate_ad_group_criteria(customer_id=CID, operations=kw_ops)

            rsa = RSAS[(name, ag_name)]
            adop = client.get_type("AdGroupAdOperation")
            ada = adop.create
            ada.ad_group = ag_rn
            ada.status = client.enums.AdGroupAdStatusEnum.ENABLED
            ada.ad.final_urls.append(rsa["url"])
            for h in rsa["h"]:
                a = client.get_type("AdTextAsset"); a.text = h
                ada.ad.responsive_search_ad.headlines.append(a)
            for d in rsa["d"]:
                a = client.get_type("AdTextAsset"); a.text = d
                ada.ad.responsive_search_ad.descriptions.append(a)
            ada.ad.responsive_search_ad.path1 = rsa["p1"]
            ada.ad.responsive_search_ad.path2 = rsa["p2"]
            ad_svc.mutate_ad_group_ads(customer_id=CID, operations=[adop])
            print(f"  adgroup {ag_name}: {len(kws)} kw + RSA")

    if "--enable" in sys.argv:
        ops = []
        for name, rn in created.items():
            op = client.get_type("CampaignOperation")
            op.update.resource_name = rn
            op.update.status = client.enums.CampaignStatusEnum.ENABLED
            client.copy_from(op.update_mask, client.get_type("FieldMask")(paths=["status"]))
            ops.append(op)
        camp_svc.mutate_campaigns(customer_id=CID, operations=ops)
        print("all campaigns ENABLED")
    else:
        print("campaigns left PAUSED (rerun with --enable to go live)")

if __name__ == "__main__":
    main()
