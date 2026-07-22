"""Structured paid-ads diagnosis shared by every product and ad channel.

The module deliberately separates facts from judgement:
  * raw counts/money are normalized into one dimension table;
  * ratios are derived from totals, never averaged;
  * Campaign -> Creative -> Lander -> Offer stages expose missing data;
  * recommendations are blocked from scaling when revenue is not reconciled.
"""
from datetime import datetime, timezone


DIMENSIONS = ("date", "account", "campaign", "creative", "placement", "angle", "lander", "offer")
BASE_METRICS = ("spend", "impressions", "clicks", "conversions", "revenue")


def _number(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _divide(numerator, denominator):
    return numerator / denominator if denominator else None


def normalize_dimension_row(row):
    out = dict(row)
    out.update({key: str(row.get(key) or "") for key in DIMENSIONS})
    for key in BASE_METRICS:
        value = row.get(key)
        out[key] = None if key == "revenue" and value is None else round(_number(value), 6)

    spend = out["spend"]
    impressions = out["impressions"]
    clicks = out["clicks"]
    conversions = out["conversions"]
    revenue = out["revenue"]
    out.update({
        "ctr": _divide(clicks * 100, impressions),
        "cpc": _divide(spend, clicks),
        "cvr": _divide(conversions * 100, clicks),
        "cpa": _divide(spend, conversions),
        "roas": _divide(revenue, spend) if revenue is not None else None,
        "profit": round(revenue - spend, 6) if revenue is not None else None,
    })
    for key in ("ctr", "cpc", "cvr", "cpa", "roas"):
        if out[key] is not None:
            out[key] = round(out[key], 4)
    return out


def _metric(label, value, unit=None, target=None):
    return {"label": label, "value": value, "unit": unit, "target": target}


def build_methodology(snapshot, *, channel, account_id=None, dimensions=None, target_roas=1.0, benchmark=None):
    """Return the dashboard `methodology` contract for one channel snapshot."""
    today = snapshot.get("today") or {}
    revenue = snapshot.get("revenue") or {}
    rows = [normalize_dimension_row(row) for row in (dimensions or [])]
    real_revenue = revenue.get("real_usd")
    real_roas = revenue.get("real_roas")
    traffic_ready = _number(today.get("impr")) > 0
    creative_ready = any(row.get("creative") or row.get("angle") for row in rows)
    lander_ready = any(row.get("lander") for row in rows) and any("lp_ctr" in row or "lp_epc" in row for row in (dimensions or []))
    revenue_ready = real_revenue is not None
    attribution_ready = bool(snapshot.get("attribution_ready"))
    raw_checked_at = snapshot.get("raw_checked_at")

    stages = [
        {
            "key": "campaign", "label": "Campaign 设置", "status": "watch" if traffic_ready else "unknown",
            "decision": "按市场、时段、placement 与出价逐层拆分；只改变一个定向变量。" if traffic_ready else "等待首批可归因流量。",
            "evidence": "花费 $%.2f · %d impressions · %d clicks" % (
                _number(today.get("cost")), int(_number(today.get("impr"))), int(_number(today.get("clicks")))),
            "metrics": [
                _metric("CTR", round(_number(today.get("ctr")), 4), "%"),
                _metric("CPC", round(_number(today.get("cpc")), 4), "$"),
            ],
        },
        {
            "key": "creative", "label": "Creative", "status": "watch" if creative_ready else "unknown",
            "decision": "先测 angle，再测执行；CTR 赢但 CVR/收入输时不得放量。" if creative_ready else "同步 creative_id 与 angle_id 后才能判断素材。",
            "evidence": "%d 条带 creative/angle 的结构化数据" % sum(bool(row.get("creative") or row.get("angle")) for row in rows),
        },
        {
            "key": "lander", "label": "Lander", "status": "watch" if lander_ready else "unknown",
            "decision": "用 lpCTR 与 lpEPC 比较落地页，并保持上游素材不变。" if lander_ready else "补 LP view → CTA click → 注册/激活，计算 lpCTR 与 lpEPC。",
            "evidence": "落地页过程指标已接入" if lander_ready else "缺少落地页过程指标",
        },
        {
            "key": "offer", "label": "Offer",
            "status": "pass" if revenue_ready and real_roas is not None and _number(real_roas) >= target_roas else "fail" if revenue_ready else "unknown",
            "decision": "达到利润红线，可设计小步放量并观察边际 ROAS。" if revenue_ready and real_roas is not None and _number(real_roas) >= target_roas else "真实 ROAS 未达红线，先修 Offer/支付漏斗。" if revenue_ready else "回传实付金额、币种、退款与支付时间；禁止用注册价值代替收入。",
            "evidence": "真实收入 %s · 真实 ROAS %s" % (
                "$%.2f" % _number(real_revenue) if revenue_ready else "未回传",
                "%.2fx" % _number(real_roas) if real_roas is not None else "—"),
            "metrics": [_metric("真实 ROAS", real_roas, "x", target_roas)],
        },
    ]

    issues = []
    if not attribution_ready:
        issues.append("点击 ID → 用户 → 支付归因未确认")
    if not creative_ready:
        issues.append("缺 creative / angle 维度")
    if not lander_ready:
        issues.append("缺 lpCTR / lpEPC")
    if not revenue_ready:
        issues.append("真实支付收入未回传")
    if not raw_checked_at:
        issues.append("尚未抽样复核原始日志")

    recommendations = []
    if not revenue_ready or not attribution_ready:
        recommendations.append({
            "priority": 1, "stage": "offer", "action": "先焊接真实收入归因，再允许放量",
            "why": "没有 click ID 与实付金额，平台转化价值可能只是注册代理值，任何 ROAS 结论都不可信。",
            "confidence": "high", "next_check_at": "tracking repair 完成后立即",
        })
    if not lander_ready:
        recommendations.append({
            "priority": 2, "stage": "lander", "action": "补齐 LP 过程事件并计算 lpCTR / lpEPC",
            "why": "当前只能看到广告点击和注册，无法判断是素材失配还是落地页漏水。",
            "confidence": "high", "next_check_at": "累计 100 次 LP view 后",
        })
    if traffic_ready:
        recommendations.append({
            "priority": 3, "stage": "campaign", "action": "按单一维度拆分最大花费段",
            "why": "先从 spend 最大的市场/时段/placement 下钻，避免同时改多个变量导致结论失真。",
            "confidence": "medium", "next_check_at": "下一个完整业务日",
        })

    return {
        "version": 1,
        "question": "%s 当前最大的利润瓶颈在哪一层？" % channel.title(),
        "objective": {
            "metric": "verified_profit / real_roas",
            "target": target_roas,
            "currency": "USD",
            "window": "rolling_7d",
            "guardrails": ["P2 payment is primary", "one variable per experiment", "no scaling without reconciled revenue"],
        },
        "stages": stages,
        "dimensions": rows,
        "experiments": [],
        "recommendations": recommendations,
        "benchmark": benchmark or {"source": "project baseline", "period": "previous comparable window", "note": "External thresholds are hypotheses until this account validates them."},
        "data_quality": {
            "tracking_ready": attribution_ready,
            "revenue_reconciled": revenue_ready,
            "raw_checked_at": raw_checked_at,
            "issues": issues,
            "account_id": str(account_id or ""),
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
    }
