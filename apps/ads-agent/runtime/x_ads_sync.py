#!/usr/bin/env python3
"""Read X Ads delivery data and optionally ingest a workspace-scoped GTM batch.

Importing this module has no network or credential side effects. X Ads uses
OAuth 1.0a credentials from explicit environment variables or macOS Keychain.
The GTM workspace token is resolved only when ``--push`` is supplied.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path


AGENT_ID = "paid-ads-agent"
AGENT_KEY = "ads-agent"
PLATFORM = "paid_ads"
ARTIFACT_TYPE = "campaign"
NODE_ID = "x-ads-sync"
X_ADS_BASE_URL = "https://ads-api.x.com/12"
GTM_INGEST_URL = "https://gtm.shulex.com/api/swarm/ingest"
WORKSPACE_TOKEN_KEYCHAIN_SERVICE = "gtm-swarm-workspace-token"
DEFAULT_CONFIG = Path(__file__).resolve().parents[1] / "products" / "flatkey" / "x-ads.json"

METRIC_NAMES = (
    "spend_usd",
    "impressions",
    "link_clicks",
    "ctr_percent",
    "cpc_usd",
    "conversions",
    "revenue_usd",
    "roas",
)

ADDITIVE_METRICS = {
    "spend_usd",
    "impressions",
    "link_clicks",
    "conversions",
    "revenue_usd",
}

RATIO_METRICS = {
    "ctr_percent": ("link_clicks", "impressions", 100),
    "cpc_usd": ("spend_usd", "link_clicks", 1),
    "roas": ("revenue_usd", "spend_usd", 1),
}

OAUTH_SECRET_SOURCES = {
    "api_key": ("X_ADS_API_KEY", "codex-x-ads-api-key"),
    "api_secret": ("X_ADS_API_SECRET", "codex-x-ads-api-secret"),
    "access_token": ("X_ADS_ACCESS_TOKEN", "codex-x-ads-access-token"),
    "access_token_secret": (
        "X_ADS_ACCESS_TOKEN_SECRET",
        "codex-x-ads-access-token-secret",
    ),
}

FORBIDDEN_CONFIG_KEYS = {
    "api_key",
    "api_secret",
    "consumer_key",
    "consumer_secret",
    "access_token",
    "access_token_secret",
    "workspace_token",
    "bearer_token",
    "password",
    "credential",
    "credentials",
    "refresh_token",
    "session_token",
    "client_secret",
    "developer_token",
    "oauth_token",
    "oauth_token_secret",
    "private_key",
    "secret_access_key",
    "secret",
    "token",
}


class ConfigError(ValueError):
    """Raised when the non-secret JSON configuration is unsafe or invalid."""


def _normalized_key(value):
    separated = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", str(value).strip())
    return re.sub(r"[^a-z0-9]+", "_", separated.lower()).strip("_")


def _is_forbidden_config_key(value):
    normalized = _normalized_key(value)
    return any(
        normalized == forbidden or normalized.endswith(f"_{forbidden}")
        for forbidden in FORBIDDEN_CONFIG_KEYS
    )


def _reject_inline_secrets(value, path="config"):
    if isinstance(value, dict):
        for key, item in value.items():
            if _is_forbidden_config_key(key):
                raise ConfigError(f"{path}.{key} must not contain credentials")
            _reject_inline_secrets(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _reject_inline_secrets(item, f"{path}[{index}]")


def _required_text(value, name, limit=200):
    text = str(value or "").strip()
    if not text:
        raise ConfigError(f"{name} is required")
    if len(text) > limit:
        raise ConfigError(f"{name} is too long")
    return text


def _external_id(value, name):
    text = _required_text(value, name, 100)
    if not re.fullmatch(r"[A-Za-z0-9_-]+", text):
        raise ConfigError(f"{name} is invalid")
    return text


def _utc_timestamp(value, name):
    text = _required_text(value, name, 80)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ConfigError(f"{name} must be an ISO 8601 timestamp") from exc
    if parsed.tzinfo is None:
        raise ConfigError(f"{name} must include a timezone")
    return parsed.astimezone(timezone.utc)


def _iso_z(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def load_config(path):
    """Load and validate one non-secret workspace/campaign configuration."""
    config_path = Path(path).expanduser()
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigError(f"cannot load X Ads config: {config_path}") from exc
    if not isinstance(raw, dict):
        raise ConfigError("config must be a JSON object")
    _reject_inline_secrets(raw)

    workspace = _required_text(raw.get("workspace"), "workspace", 100)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", workspace):
        raise ConfigError("workspace is invalid")

    promoted = raw.get("promoted_tweet_ids")
    if not isinstance(promoted, list) or not promoted:
        raise ConfigError("promoted_tweet_ids must be a non-empty array")
    promoted_ids = [_external_id(item, "promoted_tweet_ids") for item in promoted]
    if len(promoted_ids) != len(set(promoted_ids)):
        raise ConfigError("promoted_tweet_ids must be unique")

    try:
        budget = float(raw.get("daily_budget_usd"))
    except (TypeError, ValueError) as exc:
        raise ConfigError("daily_budget_usd must be numeric") from exc
    if not math.isfinite(budget) or budget < 0:
        raise ConfigError("daily_budget_usd must be a non-negative finite number")

    start_time = _utc_timestamp(raw.get("start_time"), "start_time")
    return {
        "workspace": workspace,
        "project_display_name": _required_text(
            raw.get("project_display_name") or workspace,
            "project_display_name",
            100,
        ),
        "account_id": _external_id(raw.get("account_id"), "account_id"),
        "campaign_id": _external_id(raw.get("campaign_id"), "campaign_id"),
        "campaign_name": str(raw.get("campaign_name") or "").strip(),
        "line_item_id": _external_id(raw.get("line_item_id"), "line_item_id"),
        "promoted_tweet_ids": promoted_ids,
        "country": _required_text(raw.get("country"), "country", 16).upper(),
        "language": _required_text(raw.get("language"), "language", 16).lower(),
        "daily_budget_usd": round(budget, 6),
        "start_time": _iso_z(start_time),
    }


def keychain_secret(service, account=None):
    """Read one secret without printing it or accepting it on the command line."""
    command = ["security", "find-generic-password", "-s", service]
    if account:
        command.extend(["-a", account])
    command.append("-w")
    try:
        result = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise RuntimeError(f"Keychain item unavailable: {service}") from exc
    value = result.stdout.strip()
    if not value:
        raise RuntimeError(f"Keychain item is empty: {service}")
    return value


def _secret_from_env_or_keychain(env_name, service, environ=None, keychain_reader=None):
    env = os.environ if environ is None else environ
    value = str(env.get(env_name) or "").strip()
    if value:
        return value
    reader = keychain_secret if keychain_reader is None else keychain_reader
    try:
        value = str(reader(service) or "").strip()
    except Exception as exc:
        raise RuntimeError(
            f"missing credential: set {env_name} or Keychain service {service}"
        ) from exc
    if not value:
        raise RuntimeError(
            f"missing credential: set {env_name} or Keychain service {service}"
        )
    return value


def load_oauth_credentials(environ=None, keychain_reader=None):
    """Resolve X OAuth values at runtime; callers must never serialize them."""
    return {
        name: _secret_from_env_or_keychain(
            env_name,
            service,
            environ=environ,
            keychain_reader=keychain_reader,
        )
        for name, (env_name, service) in OAUTH_SECRET_SOURCES.items()
    }


def workspace_token_env(workspace):
    suffix = re.sub(r"[^A-Za-z0-9]+", "_", workspace).strip("_").upper()
    return f"GTM_SWARM_TOKEN_{suffix}"


def load_workspace_token(config, environ=None, keychain_reader=None):
    """Resolve only the token for the config's immutable workspace slug."""
    env = os.environ if environ is None else environ
    scoped_name = workspace_token_env(config["workspace"])
    for env_name in (scoped_name, "GTM_SWARM_TOKEN"):
        value = str(env.get(env_name) or "").strip()
        if value:
            return value
    reader = keychain_secret if keychain_reader is None else keychain_reader
    account = config["workspace"]
    try:
        value = str(reader(WORKSPACE_TOKEN_KEYCHAIN_SERVICE, account) or "").strip()
    except Exception as exc:
        raise RuntimeError(
            "missing credential: set "
            f"{scoped_name} or Keychain service "
            f"{WORKSPACE_TOKEN_KEYCHAIN_SERVICE} account {account}"
        ) from exc
    if not value:
        raise RuntimeError(
            "missing credential: set "
            f"{scoped_name} or Keychain service "
            f"{WORKSPACE_TOKEN_KEYCHAIN_SERVICE} account {account}"
        )
    return value


def make_api_getter(credentials, session=None, oauth_factory=None):
    """Create a read-only X Ads GET function. No call occurs until invoked."""
    if session is None:
        import requests

        session = requests.Session()
    if oauth_factory is None:
        from requests_oauthlib import OAuth1

        oauth_factory = OAuth1
    auth = oauth_factory(
        credentials["api_key"],
        credentials["api_secret"],
        credentials["access_token"],
        credentials["access_token_secret"],
    )

    def api_get(path, params=None):
        if not path.startswith("/") or ".." in path:
            raise ValueError("unsafe X Ads API path")
        try:
            response = session.get(
                f"{X_ADS_BASE_URL}{path}",
                params=params or {},
                auth=auth,
                timeout=30,
            )
        except Exception as exc:
            raise RuntimeError("X Ads GET failed") from exc
        status = int(getattr(response, "status_code", 0) or 0)
        if status < 200 or status >= 300:
            raise RuntimeError(f"X Ads GET failed: HTTP {status}")
        try:
            payload = response.json()
        except Exception as exc:
            raise RuntimeError("X Ads GET returned invalid JSON") from exc
        if not isinstance(payload, dict):
            raise RuntimeError("X Ads GET returned an invalid payload")
        return payload

    return api_get


def _number(value):
    if value is None or isinstance(value, bool):
        return 0.0
    if isinstance(value, (list, tuple)):
        return sum(_number(item) for item in value)
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if math.isfinite(number) else 0.0


def _metrics_for_row(row):
    totals = {}
    for item in row.get("id_data") or []:
        metrics = item.get("metrics") if isinstance(item, dict) else None
        if not isinstance(metrics, dict):
            continue
        for name, value in metrics.items():
            totals[name] = totals.get(name, 0.0) + _number(value)
    return totals


def _metrics_by_id(payload):
    output = {}
    for row in payload.get("data") or []:
        if not isinstance(row, dict):
            continue
        entity_id = str(row.get("id") or "").strip()
        if entity_id:
            output[entity_id] = _metrics_for_row(row)
    return output


def _metric(metrics, *names):
    for name in names:
        if name in metrics:
            return _number(metrics.get(name))
    return 0.0


def _campaign_metrics(metrics):
    spend = _metric(metrics, "billed_charge_local_micro") / 1_000_000
    impressions = _metric(metrics, "impressions")
    link_clicks = _metric(metrics, "link_clicks")
    if not link_clicks:
        link_clicks = _metric(metrics, "url_clicks")
    conversions = _metric(metrics, "conversion_purchases", "conversions")
    ctr = link_clicks / impressions * 100 if impressions else 0
    cpc = spend / link_clicks if link_clicks else 0
    return {
        "spend_usd": round(spend, 6),
        "impressions": round(impressions, 6),
        "link_clicks": round(link_clicks, 6),
        "ctr_percent": round(ctr, 6),
        "cpc_usd": round(cpc, 6),
        "conversions": round(conversions, 6),
        # X's platform conversion-value fields are not verified realized
        # revenue. Keep these at zero until Flatkey payment attribution joins
        # a real payment to this Campaign.
        "revenue_usd": 0,
        "roas": 0,
    }


def dashboard_spec():
    labels = {
        "spend_usd": "Spend (USD)",
        "impressions": "Impressions",
        "link_clicks": "Link Clicks",
        "ctr_percent": "CTR (%)",
        "cpc_usd": "CPC (USD)",
        "conversions": "Platform Conversions",
        "revenue_usd": "Verified Revenue",
        "roas": "ROAS",
    }
    widgets = []
    for metric in METRIC_NAMES:
        if metric in ADDITIVE_METRICS:
            query = {
                "kind": "latest_metric_sum",
                "platform": PLATFORM,
                "artifact_type": ARTIFACT_TYPE,
                "metric": metric,
            }
        else:
            numerator, denominator, multiplier = RATIO_METRICS[metric]
            query = {
                "kind": "latest_metric_ratio",
                "platform": PLATFORM,
                "artifact_type": ARTIFACT_TYPE,
                "numerator_metric": numerator,
                "denominator_metric": denominator,
                "multiplier": multiplier,
            }
        widgets.append(
            {
                "id": metric,
                "title": labels[metric],
                "type": "stat",
                "query": query,
            }
        )
    widgets.append(
        {
            "id": "campaigns",
            "title": "Campaigns",
            "type": "leaderboard",
            "query": {
                "kind": "latest_metric_leaderboard",
                "platform": PLATFORM,
                "artifact_type": ARTIFACT_TYPE,
                "metrics": list(METRIC_NAMES),
                "limit": 20,
            },
        }
    )
    return {
        "schema_version": "swarm.dashboard.v1",
        "title": "Paid Ads Campaign Performance",
        "description": (
            "Rolling 30-day platform delivery, capped at Campaign start, plus verified revenue. "
            "Verified revenue attribution is not connected yet."
        ),
        "widgets": widgets,
    }


def _entity(payload, kind):
    value = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(value, dict):
        raise RuntimeError(f"X Ads {kind} response is missing data")
    return value


def _ceil_hour(value):
    value = value.astimezone(timezone.utc)
    floor = value.replace(minute=0, second=0, microsecond=0)
    return floor if value == floor else floor + timedelta(hours=1)


def _floor_hour(value):
    return value.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


def collect_batch(config, api_get, now=None):
    """Perform read-only GETs and construct one campaign telemetry batch."""
    observed = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    account_id = config["account_id"]
    campaign_id = config["campaign_id"]
    line_item_id = config["line_item_id"]

    campaign = _entity(
        api_get(f"/accounts/{account_id}/campaigns/{campaign_id}"),
        "campaign",
    )
    line_item = _entity(
        api_get(f"/accounts/{account_id}/line_items/{line_item_id}"),
        "line item",
    )
    campaign_start = _utc_timestamp(config["start_time"], "start_time")
    rolling_start = _floor_hour(observed - timedelta(days=30))
    stats_start = max(campaign_start, rolling_start)
    stats_params = {
        "start_time": _iso_z(stats_start),
        "end_time": _iso_z(_ceil_hour(observed)),
        "granularity": "TOTAL",
        "metric_groups": "BILLING,ENGAGEMENT,WEB_CONVERSION",
        "placement": "ALL_ON_TWITTER",
    }
    campaign_stats = api_get(
        f"/stats/accounts/{account_id}",
        {**stats_params, "entity": "CAMPAIGN", "entity_ids": campaign_id},
    )
    promoted_stats = api_get(
        f"/stats/accounts/{account_id}",
        {
            **stats_params,
            "entity": "PROMOTED_TWEET",
            "entity_ids": ",".join(config["promoted_tweet_ids"]),
        },
    )

    raw_metrics = _metrics_by_id(campaign_stats).get(campaign_id, {})
    metrics = _campaign_metrics(raw_metrics)
    status = str(
        campaign.get("effective_status")
        or campaign.get("entity_status")
        or "UNKNOWN"
    )
    servable = bool(campaign.get("servable"))
    budget_micro = line_item.get("daily_budget_amount_local_micro")
    budget = (
        config["daily_budget_usd"]
        if budget_micro is None
        else _number(budget_micro) / 1_000_000
    )

    promoted = []
    promoted_metrics = _metrics_by_id(promoted_stats)
    for promoted_id in config["promoted_tweet_ids"]:
        item = _campaign_metrics(promoted_metrics.get(promoted_id, {}))
        promoted.append({"id": promoted_id, **item})

    observed_at = _iso_z(observed)
    payload = {
        "channel": "x",
        "status": status,
        "servable": servable,
        "country": config["country"],
        "language": config["language"],
        "daily_budget_usd": round(budget, 6),
        "line_item_id": line_item_id,
        "promoted_tweets": promoted,
    }
    artifact = {
        "platform": PLATFORM,
        "artifact_type": ARTIFACT_TYPE,
        "external_id": campaign_id,
        "title": str(campaign.get("name") or config["campaign_name"] or campaign_id),
        "created_at": config["start_time"],
        "source_time": observed_at,
        "payload": payload,
    }
    observation = {
        "platform": PLATFORM,
        "artifact_type": ARTIFACT_TYPE,
        "external_id": campaign_id,
        "observed_at": observed_at,
        "metrics": metrics,
        "payload": {
            "channel": "x",
            "window_start": stats_params["start_time"],
            "window_end": stats_params["end_time"],
        },
    }
    return {
        "schema_version": "swarm.telemetry.v1",
        "workspace": config["workspace"],
        "agent_id": AGENT_ID,
        "agent_key": AGENT_KEY,
        "node_id": NODE_ID,
        "sent_at": observed_at,
        "artifacts": [artifact],
        "observations": [observation],
        "dashboard_spec": dashboard_spec(),
    }


def push_batch(batch, token, post=None):
    """POST one credential-free batch to the fixed GTM ingest endpoint."""
    if post is None:
        import requests

        post = requests.post
    try:
        response = post(
            GTM_INGEST_URL,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=batch,
            timeout=30,
        )
    except Exception as exc:
        raise RuntimeError("GTM ingest request failed") from exc
    status = int(getattr(response, "status_code", 0) or 0)
    if status < 200 or status >= 300:
        raise RuntimeError(f"GTM ingest failed: HTTP {status}")
    try:
        payload = response.json()
    except Exception as exc:
        raise RuntimeError("GTM ingest returned invalid JSON") from exc
    if not isinstance(payload, dict) or not payload.get("ok"):
        raise RuntimeError("GTM ingest rejected the batch")
    return payload


def safe_summary(batch, pushed=False, ingest=None):
    artifact = batch["artifacts"][0]
    summary = {
        "workspace": batch["workspace"],
        "agent_id": batch["agent_id"],
        "agent_key": batch["agent_key"],
        "platform": batch["observations"][0]["platform"],
        "campaign_id": artifact["external_id"],
        "status": artifact["payload"]["status"],
        "servable": artifact["payload"]["servable"],
        "metrics": batch["observations"][0]["metrics"],
        "pushed": bool(pushed),
    }
    if ingest is not None:
        summary["ingest"] = {
            "ok": bool(ingest.get("ok")),
            "artifacts_upserted": int((ingest.get("artifacts") or {}).get("upserted") or 0),
            "observations_inserted": int((ingest.get("observations") or {}).get("inserted") or 0),
        }
    return summary


def run(
    config_path=DEFAULT_CONFIG,
    push=False,
    environ=None,
    keychain_reader=None,
    api_get=None,
    post=None,
    now=None,
    printer=print,
):
    config = load_config(config_path)
    if api_get is None:
        credentials = load_oauth_credentials(
            environ=environ,
            keychain_reader=keychain_reader,
        )
        api_get = make_api_getter(credentials)
    batch = collect_batch(config, api_get, now=now)
    ingest = None
    if push:
        token = load_workspace_token(
            config,
            environ=environ,
            keychain_reader=keychain_reader,
        )
        ingest = push_batch(batch, token, post=post)
    summary = safe_summary(batch, pushed=push, ingest=ingest)
    printer(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return summary, batch


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Read X Ads campaign metrics; add --push to ingest them into GTM Swarm."
    )
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="non-secret JSON config")
    parser.add_argument(
        "--push",
        action="store_true",
        help=f"POST the credential-free batch to {GTM_INGEST_URL}",
    )
    args = parser.parse_args(argv)
    try:
        run(config_path=args.config, push=args.push)
    except (ConfigError, RuntimeError) as exc:
        parser.exit(1, f"x_ads_sync: {exc}\n")


if __name__ == "__main__":
    main()
