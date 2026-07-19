#!/usr/bin/env python3
"""11agents Ads Executor — closes the recommend → approve → execute → observe loop.

Each cycle:
  1. SYNC   pull campaign (and periodically keyword/search-term) state from
            Google Ads and push snapshots to the platform, so war-room
            recommendations always run on fresh reality.
  2. CLAIM  atomically claim queued ad_actions from the platform.
  3. EXECUTE apply each mutation via the Google Ads API (ARMED=1) or plan it
            (dry-run) — pause / resume / budget_up / add_negative /
            add_keyword / pause_keyword / bid_adjust.
  4. REPORT write the outcome back (executed | failed | dry_run).

Auth: platform session login from ADS_AGENT_ENV (never committed).
Google Ads credentials come from GOOGLE_ADS_ENV (never committed).
Campaign→project bucketing is explicit. Unknown prefixes are skipped instead
of being silently assigned to Solvea.
Run under launchd (com.11agents.ads-executor) with KeepAlive.
"""
import json
import os
import sys
import time
import traceback
import urllib.request
import http.cookiejar
from google.protobuf import field_mask_pb2

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.environ.get("ADS_AGENT_ENV", os.path.join(APP_ROOT, ".env"))
KEYWORD_SYNC_EVERY = 6  # cycles (~30 min at 300s)


def load_env(path):
    cfg = dict(os.environ)
    if not path or not os.path.exists(path):
        return cfg
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                cfg.setdefault(key.strip(), value.strip())
    return cfg


ENV = load_env(ENV_PATH)
GOOGLE_ENV = os.path.expanduser(
    ENV.get("GOOGLE_ADS_ENV", "~/.config/gtm-swarm/google-ads.env")
)
APP = ENV.get("APP_URL", "").rstrip("/")
ARMED = ENV.get("ARMED", "0") == "1"
ALLOW_ENABLE = ENV.get("ALLOW_ENABLE", "0") == "1"
POLL = int(ENV.get("POLL_SECONDS", "300"))
CID = ENV.get("GOOGLE_ADS_CUSTOMER_ID") or ENV.get("CID", "")

_jar = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_jar))


def api(path, payload=None, timeout=60):
    req = urllib.request.Request(
        APP + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Content-Type": "application/json"},
        method="POST" if payload is not None else "GET",
    )
    with _opener.open(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def login():
    required = [key for key in ("APP_URL", "EMAIL", "PASSWORD") if not ENV.get(key)]
    if required:
        raise RuntimeError("missing platform config: %s" % ", ".join(required))
    out = api("/api/auth/login", {"email": ENV["EMAIL"], "password": ENV["PASSWORD"]})
    if not out.get("user"):
        raise RuntimeError("platform login failed: %s" % out)
    log("logged in as %s" % out["user"]["email"])


def log(msg):
    print("[%s] %s" % (time.strftime("%m-%d %H:%M:%S"), msg), flush=True)


def project_of(campaign_name):
    name = (campaign_name or "").upper()
    if name.startswith("VOC-"):
        return "voc"
    if name.startswith("FLATKEY-") or name.startswith("FK-"):
        return "flatkey"
    if name.startswith("SOLVEA-") or name.startswith("GADS-US-"):
        return "solvea"
    return None


# ---------------- Google Ads ----------------

def gclient():
    from google.ads.googleads.client import GoogleAdsClient
    cfg = load_env(GOOGLE_ENV)
    if not CID:
        raise RuntimeError("missing GOOGLE_ADS_CUSTOMER_ID")
    required = [
        key for key in ("DEVELOPER_TOKEN", "CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN")
        if not cfg.get(key)
    ]
    if required:
        raise RuntimeError("missing Google Ads config: %s" % ", ".join(required))
    return GoogleAdsClient.load_from_dict({
        "developer_token": cfg["DEVELOPER_TOKEN"],
        "client_id": cfg["CLIENT_ID"],
        "client_secret": cfg["CLIENT_SECRET"],
        "refresh_token": cfg["REFRESH_TOKEN"],
        "login_customer_id": ENV.get("LOGIN_CID") or None,
        "use_proto_plus": True,
    })


def gaql(client, query):
    # Paged unary search — the streaming variant dies with 'Channel deallocated'
    # on this network path (proxied gRPC); search() is what push_daily_stats
    # has run reliably from this machine for a week.
    ga = client.get_service("GoogleAdsService")
    return ga.search(customer_id=CID, query=query)


def pull_campaigns(client):
    rows = []
    q = """
        SELECT campaign.id, campaign.name, campaign.status, campaign.campaign_budget,
               metrics.cost_micros, metrics.clicks, metrics.conversions, metrics.conversions_value
        FROM campaign WHERE segments.date DURING LAST_30_DAYS"""
    for r in gaql(client, q):
            rows.append({
                "external_id": str(r.campaign.id),
                "name": r.campaign.name,
                "status": r.campaign.status.name.lower(),
                "budget_res": r.campaign.campaign_budget,
                "cost": r.metrics.cost_micros / 1e6,
                "clicks": int(r.metrics.clicks),
                "conversions": float(r.metrics.conversions),
                "conv_value": float(r.metrics.conversions_value),
            })
    return rows


def pull_keywords(client):
    rows = []
    q = """
        SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
               ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
               ad_group_criterion.keyword.match_type, ad_group_criterion.status,
               metrics.cost_micros, metrics.clicks, metrics.impressions,
               metrics.conversions, metrics.conversions_value, metrics.average_cpc
        FROM keyword_view WHERE segments.date DURING LAST_30_DAYS"""
    for r in gaql(client, q):
            rows.append({
                "campaign_external_id": str(r.campaign.id),
                "campaign_name": r.campaign.name,
                "ad_group_external_id": str(r.ad_group.id),
                "ad_group_name": r.ad_group.name,
                "external_id": str(r.ad_group_criterion.criterion_id),
                "text": r.ad_group_criterion.keyword.text,
                "match_type": r.ad_group_criterion.keyword.match_type.name,
                "status": r.ad_group_criterion.status.name.lower(),
                "cost": r.metrics.cost_micros / 1e6,
                "clicks": int(r.metrics.clicks),
                "impressions": int(r.metrics.impressions),
                "conversions": float(r.metrics.conversions),
                "conv_value": float(r.metrics.conversions_value),
                "cpc": r.metrics.average_cpc / 1e6,
            })
    return rows


def pull_search_terms(client):
    rows = []
    q = """
        SELECT campaign.id, campaign.name, ad_group.id,
               search_term_view.search_term, search_term_view.status,
               segments.keyword.info.text, segments.keyword.info.match_type,
               metrics.cost_micros, metrics.clicks, metrics.impressions,
               metrics.conversions, metrics.conversions_value
        FROM search_term_view WHERE segments.date DURING LAST_30_DAYS"""
    for r in gaql(client, q):
            rows.append({
                "campaign_external_id": str(r.campaign.id),
                "campaign_name": r.campaign.name,
                "ad_group_external_id": str(r.ad_group.id),
                "term": r.search_term_view.search_term,
                "matched_keyword": r.segments.keyword.info.text,
                "match_type": r.segments.keyword.info.match_type.name,
                "cost": r.metrics.cost_micros / 1e6,
                "clicks": int(r.metrics.clicks),
                "impressions": int(r.metrics.impressions),
                "conversions": float(r.metrics.conversions),
                "conv_value": float(r.metrics.conversions_value),
                "is_negative": r.search_term_view.status.name == "EXCLUDED",
                "is_keyword": r.search_term_view.status.name == "ADDED",
            })
    return rows


def bucket(rows, key="name"):
    out = {}
    skipped = 0
    for r in rows:
        slug = project_of(r.get(key) or r.get("campaign_name") or "")
        if not slug:
            skipped += 1
            continue
        out.setdefault(slug, []).append(r)
    if skipped:
        log("skipped %d row(s) with unmapped campaign prefixes" % skipped)
    return out


def sync(client, with_keywords):
    campaigns = pull_campaigns(client)
    for c in campaigns:
        c.pop("budget_res", None)
    by_slug = bucket(campaigns)
    kws = bucket(pull_keywords(client), key="campaign_name") if with_keywords else {}
    terms = bucket(pull_search_terms(client), key="campaign_name") if with_keywords else {}
    for slug in set(list(by_slug) + list(kws) + list(terms)):
        payload = {
            "slug": slug,
            "campaigns": by_slug.get(slug, []),
            "keywords": kws.get(slug, []),
            "search_terms": terms.get(slug, []),
        }
        out = api("/api/ads-executor/sync", payload, timeout=120)
        log("sync %s -> %s" % (slug, out.get("counts")))


# ---------------- mutations ----------------

def campaign_resource(client, campaign_id):
    return client.get_service("CampaignService").campaign_path(CID, campaign_id)


def set_campaign_status(client, campaign_id, status_name):
    svc = client.get_service("CampaignService")
    op = client.get_type("CampaignOperation")
    c = op.update
    c.resource_name = campaign_resource(client, campaign_id)
    c.status = client.enums.CampaignStatusEnum[status_name]
    client.copy_from(op.update_mask, field_mask_pb2.FieldMask(paths=["status"]))
    svc.mutate_campaigns(customer_id=CID, operations=[op])


def raise_budget(client, campaign_id, pct, cap_usd):
    res, cur = None, None
    for r in gaql(client, """
        SELECT campaign.id, campaign.campaign_budget, campaign_budget.amount_micros
        FROM campaign WHERE campaign.id = %s""" % int(campaign_id)):
        res, cur = r.campaign.campaign_budget, r.campaign_budget.amount_micros
    if not res:
        raise RuntimeError("budget not found for campaign %s" % campaign_id)
    new = int(cur * (1 + pct / 100.0))
    if cap_usd:
        new = min(new, int(float(cap_usd) * 1e6))
    if new <= cur:
        return {"before_usd": cur / 1e6, "after_usd": cur / 1e6, "note": "cap reached; unchanged"}
    svc = client.get_service("CampaignBudgetService")
    op = client.get_type("CampaignBudgetOperation")
    b = op.update
    b.resource_name = res
    b.amount_micros = new
    client.copy_from(op.update_mask, field_mask_pb2.FieldMask(paths=["amount_micros"]))
    svc.mutate_campaign_budgets(customer_id=CID, operations=[op])
    return {"before_usd": cur / 1e6, "after_usd": new / 1e6}


def add_negative_keyword(client, campaign_id, text):
    svc = client.get_service("CampaignCriterionService")
    op = client.get_type("CampaignCriterionOperation")
    cr = op.create
    cr.campaign = campaign_resource(client, campaign_id)
    cr.negative = True
    cr.keyword.text = text
    cr.keyword.match_type = client.enums.KeywordMatchTypeEnum.EXACT
    svc.mutate_campaign_criteria(customer_id=CID, operations=[op])


def add_keyword(client, ad_group_id, text, match_type):
    svc = client.get_service("AdGroupCriterionService")
    op = client.get_type("AdGroupCriterionOperation")
    cr = op.create
    cr.ad_group = client.get_service("AdGroupService").ad_group_path(CID, ad_group_id)
    cr.status = client.enums.AdGroupCriterionStatusEnum.ENABLED
    cr.keyword.text = text
    cr.keyword.match_type = client.enums.KeywordMatchTypeEnum[(match_type or "EXACT").upper()]
    svc.mutate_ad_group_criteria(customer_id=CID, operations=[op])


def set_keyword_status(client, ad_group_id, criterion_id, status_name):
    svc = client.get_service("AdGroupCriterionService")
    op = client.get_type("AdGroupCriterionOperation")
    cr = op.update
    cr.resource_name = svc.ad_group_criterion_path(CID, ad_group_id, criterion_id)
    cr.status = client.enums.AdGroupCriterionStatusEnum[status_name]
    client.copy_from(op.update_mask, field_mask_pb2.FieldMask(paths=["status"]))
    svc.mutate_ad_group_criteria(customer_id=CID, operations=[op])


def adjust_keyword_bid(client, ad_group_id, criterion_id, pct):
    svc = client.get_service("AdGroupCriterionService")
    cur = None
    for r in gaql(client, """
        SELECT ad_group_criterion.criterion_id, ad_group_criterion.effective_cpc_bid_micros
        FROM ad_group_criterion
        WHERE ad_group_criterion.criterion_id = %s AND ad_group.id = %s""" % (int(criterion_id), int(ad_group_id))):
        cur = r.ad_group_criterion.effective_cpc_bid_micros
    if not cur:
        raise RuntimeError("bid not found for criterion %s" % criterion_id)
    new = max(int(0.01 * 1e6), int(cur * (1 + pct / 100.0)))
    op = client.get_type("AdGroupCriterionOperation")
    cr = op.update
    cr.resource_name = svc.ad_group_criterion_path(CID, ad_group_id, criterion_id)
    cr.cpc_bid_micros = new
    client.copy_from(op.update_mask, field_mask_pb2.FieldMask(paths=["cpc_bid_micros"]))
    svc.mutate_ad_group_criteria(customer_id=CID, operations=[op])
    return {"before_usd": cur / 1e6, "after_usd": new / 1e6}


def execute(client, action):
    p = action.get("params") or {}
    op = p.get("op")
    detail = {"op": op, "armed": ARMED}
    if not ARMED:
        return "dry_run", dict(detail, plan=p)
    if op == "resume" and not ALLOW_ENABLE:
        raise RuntimeError("resume blocked: set ALLOW_ENABLE=1 after explicit launch approval")
    if op == "pause":
        set_campaign_status(client, p["campaign_external_id"], "PAUSED")
    elif op == "resume":
        set_campaign_status(client, p["campaign_external_id"], "ENABLED")
    elif op == "budget_up":
        detail.update(raise_budget(client, p["campaign_external_id"], p.get("pct") or 30, p.get("max_daily_budget")))
    elif op == "add_negative":
        add_negative_keyword(client, p["campaign_external_id"], p["text"])
    elif op == "add_keyword":
        add_keyword(client, p["ad_group_external_id"], p["text"], p.get("match_type"))
    elif op == "pause_keyword":
        set_keyword_status(client, p["ad_group_external_id"], p["keyword_external_id"], "PAUSED")
    elif op == "bid_adjust":
        detail.update(adjust_keyword_bid(client, p["ad_group_external_id"], p["keyword_external_id"], p.get("pct") or 0))
    else:
        raise RuntimeError("unknown op: %s" % op)
    return "executed", detail


def drain(client):
    out = api("/api/ads-executor/claim", {"limit": 20})
    actions = out.get("actions") or []
    if actions:
        log("claimed %d action(s)" % len(actions))
    executed = 0
    for a in actions:
        try:
            status, result = execute(client, a)
            api("/api/ads-executor/report", {"id": a["id"], "status": status, "result": result})
            log("  %s %s -> %s %s" % (a["id"][:8], (a.get("params") or {}).get("op"), status, result))
            if status == "executed":
                executed += 1
        except Exception as e:  # report failure, keep draining
            api("/api/ads-executor/report", {"id": a["id"], "status": "failed", "result": {"error": str(e)[:500]}})
            log("  %s FAILED: %s" % (a["id"][:8], e))
    return executed


def main():
    log("executor starting (ARMED=%s, poll=%ss)" % (ARMED, POLL))
    login()
    client = gclient()
    cycle = 0
    while True:
        try:
            executed = drain(client)
            # results flow back right away after a real mutation
            sync(client, with_keywords=(cycle % KEYWORD_SYNC_EVERY == 0) or executed > 0)
        except Exception as e:
            log("cycle error: %s" % e)
            traceback.print_exc()
            try:
                login()  # session may have expired
            except Exception as e2:
                log("re-login failed: %s" % e2)
        cycle += 1
        time.sleep(POLL)


if __name__ == "__main__":
    if "--once" in sys.argv:
        login()
        c = gclient()
        drain(c)
        sync(c, with_keywords=True)
    else:
        main()
