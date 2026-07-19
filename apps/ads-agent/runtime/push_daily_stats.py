#!/usr/bin/env python3
"""Pull daily Google Ads stats and push per-project datasets to 11agents dashboards.

Projects are bucketed by explicit campaign-name prefixes:
  voc      -> campaigns 'VOC-%'        -> dashboard /voc/ads
  flatkey  -> campaigns 'flatkey-%' or 'FK-%' -> dashboard /flatkey/ads
  solvea   -> campaigns 'SOLVEA-%' or 'GADS-US-%' -> dashboard /solvea/ads

Tokens: ADS_PROJECT_TOKENS_FILE (YAML `project: token`; never committed).
Projects without a token are skipped with a warning.
Pushes last N days (default 3) so late-arriving Google stats self-correct.
"""
import os, re, sys, json, datetime, urllib.request

MCP_URL = os.environ.get("ADS_MCP_URL", "https://app.11agents.ai/mcp")
CID = os.environ.get("GOOGLE_ADS_CUSTOMER_ID", "")
LOGIN_CID = os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") or None
GOOGLE_ENV = os.environ.get(
    "GOOGLE_ADS_ENV", os.path.expanduser("~/.config/gtm-swarm/google-ads.env")
)
TOKENS_FILE = os.environ.get(
    "ADS_PROJECT_TOKENS_FILE", os.path.expanduser("~/.config/gtm-swarm/project-tokens")
)
DAYS = int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else 3

KW_SCHEMA = {
    "type": "object",
    "properties": {
        "date":        {"type": "string", "description": "business date YYYY-MM-DD"},
        "keyword":     {"type": "string"},
        "campaign":    {"type": "string"},
        "ad_group":    {"type": "string"},
        "impressions": {"type": "number"},
        "clicks":      {"type": "number"},
        "cost_usd":    {"type": "number"},
        "ctr_pct":     {"type": "number"},
        "avg_cpc_usd": {"type": "number"},
        "conversions": {"type": "number"},
    },
    "required": ["date", "keyword", "campaign", "impressions", "clicks", "cost_usd"],
}

SCHEMA = {
    "type": "object",
    "properties": {
        "date":        {"type": "string", "description": "business date YYYY-MM-DD"},
        "campaign":    {"type": "string", "description": "campaign name, TOTAL for daily rollup"},
        "impressions": {"type": "number"},
        "clicks":      {"type": "number"},
        "cost_usd":    {"type": "number"},
        "ctr_pct":     {"type": "number", "description": "clicks/impressions*100"},
        "avg_cpc_usd": {"type": "number"},
        "conversions": {"type": "number"},
        "budget_usd":  {"type": "number", "description": "daily budget"},
        "status":      {"type": "string", "description": "ENABLED/PAUSED"},
    },
    "required": ["date", "campaign", "impressions", "clicks", "cost_usd"],
}

def project_of(campaign_name):
    name = (campaign_name or "").upper()
    if name.startswith("VOC-"):
        return "voc"
    if name.startswith("FLATKEY-") or name.startswith("FK-"):
        return "flatkey"
    if name.startswith("SOLVEA-") or name.startswith("GADS-US-"):
        return "solvea"
    return None

def load_tokens():
    tokens = {}
    if os.path.exists(TOKENS_FILE):
        for line in open(TOKENS_FILE, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            m = re.match(r"([\w.-]+)\s*:\s*(\S+)", line)
            if m:
                tokens[m.group(1)] = m.group(2)
    return tokens

def ads_client():
    from google.ads.googleads.client import GoogleAdsClient
    cfg = {}
    if not CID:
        raise RuntimeError("missing GOOGLE_ADS_CUSTOMER_ID")
    for line in open(GOOGLE_ENV, encoding="utf-8"):
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

def mcp_call(token, name, arguments, rid):
    body = json.dumps({"jsonrpc": "2.0", "id": rid, "method": "tools/call",
                       "params": {"name": name, "arguments": arguments}}).encode()
    req = urllib.request.Request(MCP_URL, data=body, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream"})
    try:
        resp = json.loads(urllib.request.urlopen(req, timeout=30).read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"MCP {name}: HTTP {e.code} {e.read().decode()[:300]}")
    if "error" in resp:
        raise RuntimeError(f"MCP {name}: {resp['error']}")
    return json.loads(resp["result"]["content"][0]["text"])

def push_rows(token, dataset, schema, date, rows, rid):
    meta = {"source": "google-ads-api", "cid": CID,
            "pushed_at": datetime.datetime.now().isoformat(timespec="seconds")}
    try:
        return mcp_call(token, "data_push",
                        {"dataset": dataset, "date": date, "rows": rows, "metadata": meta}, rid)
    except RuntimeError as e:
        if "dataset" in str(e).lower() or "format" in str(e).lower() or "schema" in str(e).lower():
            mcp_call(token, "data_format_define", {"dataset": dataset, "schema": schema}, rid + "-fmt")
            return mcp_call(token, "data_push",
                            {"dataset": dataset, "date": date, "rows": rows, "metadata": meta}, rid + "-retry")
        raise

def build_snapshot(ga, proj, today):
    """Build the DailyProgress payload from Google Ads (signups/revenue wired later)."""
    conditions = {
        "voc": "campaign.name LIKE 'VOC-%'",
        "flatkey": "(campaign.name LIKE 'flatkey-%' OR campaign.name LIKE 'FK-%')",
        "solvea": "(campaign.name LIKE 'SOLVEA-%' OR campaign.name LIKE 'GADS-US-%')",
    }
    cond = conditions.get(proj)
    if not cond:
        raise RuntimeError(f"unknown project mapping: {proj}")

    def window(days):
        since = (today - datetime.timedelta(days=days - 1)).isoformat()
        agg = {"cost": 0.0, "impr": 0, "clicks": 0, "conv": 0.0}
        for r in ga.search(customer_id=CID, query=f"""
            SELECT metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
            FROM campaign WHERE {cond}
              AND segments.date BETWEEN '{since}' AND '{today.isoformat()}'"""):
            agg["cost"] += r.metrics.cost_micros / 1e6
            agg["impr"] += int(r.metrics.impressions)
            agg["clicks"] += int(r.metrics.clicks)
            agg["conv"] += r.metrics.conversions
        return agg

    t = window(1)
    wk = window(7)
    cum = window(90)
    cum_since = (today - datetime.timedelta(days=89)).isoformat()

    # live keyword roster + cumulative stats (答:"目前投放了哪些关键词")
    kw_roster = {}  # (kw, campaign) -> row
    for r in ga.search(customer_id=CID, query=f"""
        SELECT ad_group_criterion.keyword.text, campaign.name
        FROM ad_group_criterion
        WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE
          AND ad_group_criterion.status = 'ENABLED' AND campaign.status = 'ENABLED' AND {cond}"""):
        kw_roster[(r.ad_group_criterion.keyword.text, r.campaign.name)] = {
            "keyword": r.ad_group_criterion.keyword.text, "campaign": r.campaign.name,
            "impr": 0, "clicks": 0, "ctr": 0, "cpc": 0, "cost": 0.0}
    for r in ga.search(customer_id=CID, query=f"""
        SELECT ad_group_criterion.keyword.text, campaign.name,
               metrics.impressions, metrics.clicks, metrics.cost_micros
        FROM keyword_view WHERE {cond}
          AND segments.date BETWEEN '{cum_since}' AND '{today.isoformat()}'"""):
        key = (r.ad_group_criterion.keyword.text, r.campaign.name)
        row = kw_roster.setdefault(key, {"keyword": key[0], "campaign": key[1],
                                         "impr": 0, "clicks": 0, "ctr": 0, "cpc": 0, "cost": 0.0})
        m = r.metrics
        row["impr"] += int(m.impressions); row["clicks"] += int(m.clicks)
        row["cost"] = round(row["cost"] + m.cost_micros / 1e6, 2)
    keywords = sorted(kw_roster.values(), key=lambda r: (-r["cost"], -r["impr"], r["keyword"]))
    for row in keywords:
        row["ctr"] = round(row["clicks"] / row["impr"] * 100, 2) if row["impr"] else 0
        row["cpc"] = round(row["cost"] / row["clicks"], 2) if row["clicks"] else 0

    # per-campaign geo rows (market inferred from campaign name)
    MARKETS = [("-EN", "🇺🇸 美国 EN"), ("-JP", "🇯🇵 日本 JP"), ("-DE", "🇩🇪 德国 DE"),
               ("-PT", "🇧🇷 巴西 PT"), ("ES-LATAM", "🌎 拉美 ES"), ("-IN", "🇮🇳 印度 IN"),
               ("-SEA", "🌏 东南亚 SEA"), ("AF-", "🌍 非洲 AF"), ("EmergingAF", "🌍 非洲 AF")]
    def market_of(name):
        for pat, label in MARKETS:
            if pat in name: return label
        return "🇺🇸 美国 US"  # VOC 试投全部 US
    geos = []
    for r in ga.search(customer_id=CID, query=f"""
        SELECT campaign.name, metrics.impressions, metrics.clicks,
               metrics.cost_micros, metrics.conversions
        FROM campaign WHERE {cond} AND campaign.status = 'ENABLED'
          AND segments.date BETWEEN '{cum_since}' AND '{today.isoformat()}'"""):
        m = r.metrics
        geos.append({"name": r.campaign.name, "impr": int(m.impressions), "clicks": int(m.clicks),
                     "cost": m.cost_micros / 1e6, "conv": m.conversions})
    # aggregate by campaign (query returns one row per campaign per day segment absence -> already aggregated w/o date segment? keep safe: merge)
    merged = {}
    for g in geos:
        a = merged.setdefault(g["name"], {"impr": 0, "clicks": 0, "cost": 0.0, "conv": 0.0})
        for k in ("impr", "clicks", "conv"): a[k] += g[k]
        a["cost"] += g["cost"]
    geo_rows = []
    for name, a in sorted(merged.items(), key=lambda kv: -kv[1]["cost"]):
        signups = int(a["conv"])
        spend = round(a["cost"], 2)
        if spend > 20 and a["clicks"] == 0: verdict, tone = "纯浪费", "waste"
        elif signups and spend / max(signups, 1) < 10: verdict, tone = "注册便宜", "good"
        elif spend > 10 and signups == 0: verdict, tone = "待转化", "mid"
        else: verdict, tone = "观察", "mid"
        geo_rows.append({
            "market": market_of(name), "campaign": name, "spend": spend,
            "clicks": a["clicks"],
            "ctr": round(a["clicks"] / a["impr"] * 100, 2) if a["impr"] else 0,
            "cpc": round(a["cost"] / a["clicks"], 2) if a["clicks"] else 0,
            "signups": signups,
            "cpa": round(a["cost"] / signups, 2) if signups else None,
            "verdict": verdict, "tone": tone})
    ctr = round(t["clicks"] / t["impr"] * 100, 2) if t["impr"] else 0
    cpc = round(t["cost"] / t["clicks"], 2) if t["clicks"] else 0
    signups = int(t["conv"])  # 0 until site gtag lands
    funnel = [
        {"label": "曝光", "n": t["impr"], "pct": 100},
        {"label": "点击", "n": t["clicks"], "pct": round(t["clicks"] / t["impr"] * 100, 1) if t["impr"] else 0},
        {"label": "注册", "n": signups, "pct": round(signups / t["impr"] * 100, 2) if t["impr"] else 0},
    ]
    return {
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "api_ok": True,
        "today": {"cost": round(t["cost"], 2), "impr": t["impr"], "clicks": t["clicks"],
                  "ctr": ctr, "cpc": cpc, "signups": signups},
        "cum": {"cost": round(cum["cost"], 2), "conversions": round(cum["conv"], 1)},
        "revenue": {"real_usd": None, "paid_users": None, "real_roas": None},
        "funnel": funnel,
        "reconciliation": [{"ch": "Google Search", "spend": round(t["cost"], 2), "revenue": 0, "roas": None}],
        "week": {"cost": round(wk["cost"], 2), "revenue": 0, "roas": 0},
        "geos": geo_rows,
        "keywords": keywords,
    }

def main():
    tokens = load_tokens()
    client = ads_client()
    ga = client.get_service("GoogleAdsService")
    today = datetime.date.today()
    since = (today - datetime.timedelta(days=DAYS - 1)).isoformat()
    until = today.isoformat()

    # roster of live campaigns (fills zero-serving days with real zeros)
    roster = {}
    for r in ga.search(customer_id=CID, query="""
        SELECT campaign.name, campaign.status, campaign_budget.amount_micros
        FROM campaign WHERE campaign.status != 'REMOVED'"""):
        roster[r.campaign.name] = {
            "budget_usd": round(r.campaign_budget.amount_micros / 1e6, 2),
            "status": r.campaign.status.name,
        }

    # per-day keyword metrics
    kw_stats = {}  # (project, date) -> [rows]
    for r in ga.search(customer_id=CID, query=f"""
        SELECT segments.date, campaign.name, ad_group.name,
               ad_group_criterion.keyword.text,
               metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
        FROM keyword_view
        WHERE segments.date BETWEEN '{since}' AND '{until}'"""):
        proj = project_of(r.campaign.name)
        if not proj:
            continue
        m = r.metrics
        kw_stats.setdefault((proj, r.segments.date), []).append({
            "date": r.segments.date,
            "keyword": r.ad_group_criterion.keyword.text,
            "campaign": r.campaign.name,
            "ad_group": r.ad_group.name,
            "impressions": int(m.impressions),
            "clicks": int(m.clicks),
            "cost_usd": round(m.cost_micros / 1e6, 2),
            "ctr_pct": round(m.clicks / m.impressions * 100, 2) if m.impressions else 0,
            "avg_cpc_usd": round(m.cost_micros / 1e6 / m.clicks, 2) if m.clicks else 0,
            "conversions": round(m.conversions, 1),
        })

    # per-day metrics
    stats = {}  # (project, date) -> {campaign: row}
    for r in ga.search(customer_id=CID, query=f"""
        SELECT segments.date, campaign.name, campaign.status,
               campaign_budget.amount_micros,
               metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
        FROM campaign
        WHERE segments.date BETWEEN '{since}' AND '{until}'"""):
        proj = project_of(r.campaign.name)
        if not proj:
            continue
        d = r.segments.date
        stats.setdefault((proj, d), {})[r.campaign.name] = {
            "date": d, "campaign": r.campaign.name,
            "impressions": int(r.metrics.impressions),
            "clicks": int(r.metrics.clicks),
            "cost_usd": round(r.metrics.cost_micros / 1e6, 2),
            "ctr_pct": round(r.metrics.clicks / r.metrics.impressions * 100, 2) if r.metrics.impressions else 0,
            "avg_cpc_usd": round(r.metrics.cost_micros / 1e6 / r.metrics.clicks, 2) if r.metrics.clicks else 0,
            "conversions": round(r.metrics.conversions, 1),
            "budget_usd": round(r.campaign_budget.amount_micros / 1e6, 2),
            "status": r.campaign.status.name,
        }

    projects = sorted({project_of(n) for n in roster if project_of(n)})
    for proj in projects:
        token = tokens.get(proj)
        if not token:
            print(f"[skip] {proj}: no token in {TOKENS_FILE}")
            continue
        proj_roster = {n: v for n, v in roster.items() if project_of(n) == proj}
        for i in range(DAYS - 1, -1, -1):
            d = (today - datetime.timedelta(days=i)).isoformat()
            rows = dict(stats.get((proj, d), {}))
            for name, info in proj_roster.items():  # zero-fill missing campaigns
                if name not in rows:
                    rows[name] = {"date": d, "campaign": name, "impressions": 0, "clicks": 0,
                                  "cost_usd": 0, "ctr_pct": 0, "avg_cpc_usd": 0, "conversions": 0,
                                  "budget_usd": info["budget_usd"], "status": info["status"]}
            camp_rows = list(rows.values())
            total = {
                "date": d, "campaign": "TOTAL",
                "impressions": sum(r["impressions"] for r in camp_rows),
                "clicks": sum(r["clicks"] for r in camp_rows),
                "cost_usd": round(sum(r["cost_usd"] for r in camp_rows), 2),
                "conversions": round(sum(r["conversions"] for r in camp_rows), 1),
                "budget_usd": round(sum(r["budget_usd"] for r in camp_rows if r["status"] == "ENABLED"), 2),
                "status": "ENABLED" if any(r["status"] == "ENABLED" for r in camp_rows) else "PAUSED",
            }
            total["ctr_pct"] = round(total["clicks"] / total["impressions"] * 100, 2) if total["impressions"] else 0
            total["avg_cpc_usd"] = round(total["cost_usd"] / total["clicks"], 2) if total["clicks"] else 0
            out = push_rows(token, "ads", SCHEMA, d, camp_rows + [total], rid=f"{proj}-{d}")
            print(f"[{proj}] {d}: {len(camp_rows)+1} rows -> ok={out.get('ok')} accepted={out.get('accepted_rows')}")
            kw_rows = kw_stats.get((proj, d), [])
            if kw_rows:
                out = push_rows(token, "ads_keywords", KW_SCHEMA, d, kw_rows, rid=f"{proj}-kw-{d}")
                print(f"[{proj}] {d} keywords: {len(kw_rows)} rows -> ok={out.get('ok')} accepted={out.get('accepted_rows')}")

        # native 每日进度 snapshot (ads_daily_snapshot_push tool; needs platform >= 9817e32)
        try:
            snap = build_snapshot(ga, proj, today)
            out = mcp_call(token, "ads_daily_snapshot_push", {"payload": snap}, f"{proj}-snap")
            print(f"[{proj}] daily snapshot -> {out}")
        except RuntimeError as e:
            print(f"[{proj}] daily snapshot skipped: {str(e)[:120]}")

if __name__ == "__main__":
    main()
