#!/usr/bin/env python3
"""VOC test launch: verify created campaigns, set test budgets, enable.

Usage (with GOOGLE_ADS_ENV pointing to a secret file outside Git):
  grpc_proxy=127.0.0.1:7890 python3 voc_testlaunch.py          # verify only (prints state)
  grpc_proxy=127.0.0.1:7890 python3 voc_testlaunch.py --go     # set test budgets + ENABLE all VOC campaigns
  grpc_proxy=127.0.0.1:7890 python3 voc_testlaunch.py --go --full  # keep original budgets ($105/d) instead of test tier
"""
import sys, os, re
from google.api_core import protobuf_helpers

CID = os.environ.get("GOOGLE_ADS_CUSTOMER_ID", "")
LOGIN_CID = os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") or None

TEST_BUDGETS = {  # 试投档: $50/天 total
    "VOC-Agent-Conquest-US": 25.0,
    "VOC-Agent-Category-US": 15.0,
    "VOC-API-MCP-Dev-US": 5.0,
    "VOC-Brand-Defense": 5.0,
}

def client_load():
    from google.ads.googleads.client import GoogleAdsClient
    cfg = {}
    env_path = os.environ.get(
        "GOOGLE_ADS_ENV", os.path.expanduser("~/.config/gtm-swarm/google-ads.env")
    )
    for line in open(env_path):
        m = re.match(r"([A-Z_]+)=(.*)", line.strip())
        if m: cfg[m.group(1)] = m.group(2).strip().strip('"')
    return GoogleAdsClient.load_from_dict({
        "developer_token": cfg["DEVELOPER_TOKEN"],
        "client_id": cfg["CLIENT_ID"],
        "client_secret": cfg["CLIENT_SECRET"],
        "refresh_token": cfg["REFRESH_TOKEN"],
        "login_customer_id": LOGIN_CID,
        "use_proto_plus": True,
    })

def main():
    if os.environ.get("ADS_MUTATION_APPROVED") != "1":
        raise RuntimeError("mutation blocked: set ADS_MUTATION_APPROVED=1 after explicit approval")
    if not CID:
        raise RuntimeError("missing GOOGLE_ADS_CUSTOMER_ID")
    client = client_load()
    ga = client.get_service("GoogleAdsService")
    rows = list(ga.search(customer_id=CID, query="""
        SELECT campaign.id, campaign.name, campaign.status,
               campaign_budget.amount_micros, campaign_budget.resource_name,
               campaign.geo_target_type_setting.positive_geo_target_type
        FROM campaign WHERE campaign.name LIKE 'VOC-%'"""))
    if not rows:
        print("NO VOC campaigns found — creation script did not run/succeed."); sys.exit(1)
    camps = {}
    print("== VOC campaigns in account ==")
    for r in rows:
        c, b = r.campaign, r.campaign_budget
        camps[c.name] = dict(id=c.id, rn=f"customers/{CID}/campaigns/{c.id}",
                             budget_rn=b.resource_name, budget=b.amount_micros/1e6,
                             status=c.status.name)
        print(f"  {c.name:26s} id={c.id} status={c.status.name} budget=${b.amount_micros/1e6:.0f}/d geo={c.geo_target_type_setting.positive_geo_target_type.name}")

    # ad group / keyword / ad counts
    for q, label in [
        ("SELECT ad_group.id, campaign.name FROM ad_group WHERE campaign.name LIKE 'VOC-%' AND ad_group.status != 'REMOVED'", "ad groups"),
        ("SELECT ad_group_criterion.criterion_id, campaign.name FROM keyword_view WHERE campaign.name LIKE 'VOC-%'", "keywords"),
        ("SELECT ad_group_ad.ad.id, campaign.name FROM ad_group_ad WHERE campaign.name LIKE 'VOC-%' AND ad_group_ad.status != 'REMOVED'", "ads"),
    ]:
        n = sum(1 for _ in ga.search(customer_id=CID, query=q))
        print(f"  total {label}: {n}")

    if "--go" not in sys.argv:
        print("\nverify-only done. rerun with --go to set test budgets + enable.")
        return

    if "--full" not in sys.argv:
        bops = []
        bsvc = client.get_service("CampaignBudgetService")
        for name, amount in TEST_BUDGETS.items():
            if name not in camps: continue
            op = client.get_type("CampaignBudgetOperation")
            op.update.resource_name = camps[name]["budget_rn"]
            op.update.amount_micros = int(amount * 1_000_000)
            client.copy_from(op.update_mask, protobuf_helpers.field_mask(None, op.update._pb))
            bops.append(op)
        bsvc.mutate_campaign_budgets(customer_id=CID, operations=bops)
        print(f"test budgets applied: {TEST_BUDGETS} (=$50/d total)")

    csvc = client.get_service("CampaignService")
    cops = []
    for name, info in camps.items():
        if info["status"] == "ENABLED": continue
        op = client.get_type("CampaignOperation")
        op.update.resource_name = info["rn"]
        op.update.status = client.enums.CampaignStatusEnum.ENABLED
        client.copy_from(op.update_mask, protobuf_helpers.field_mask(None, op.update._pb))
        cops.append(op)
    if cops:
        csvc.mutate_campaigns(customer_id=CID, operations=cops)
    print(f"ENABLED {len(cops)} campaigns. VOC test launch is LIVE (ads enter review).")

if __name__ == "__main__":
    main()
