#!/usr/bin/env python3
"""Backfill missing PT signup bindings and settled purchases into Flatkey's outbox.

This is an idempotent production repair for successful top-ups created before
the transactional Ads attribution outbox shipped. It never prints user PII,
click IDs, or order IDs. A local Cloud SQL Auth Proxy must be listening.

Usage:
  uv run --python 3.12 --with pymysql python backfill_pt_purchase_outbox.py
  ADS_MUTATION_APPROVED=1 uv run --python 3.12 --with pymysql \
    python backfill_pt_purchase_outbox.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import time
from collections import Counter
from datetime import datetime, timezone

import pymysql


PROJECT = "vocai-gemini-prod"
SECRET = "newapi-sql-dsn"
PT_CAMPAIGN = "flatkey-pt-search"
CLICK_ID_TYPES = ("gclid", "gbraid", "wbraid")


def production_connection(port: int):
    raw = subprocess.check_output(
        [
            "gcloud",
            "secrets",
            "versions",
            "access",
            "latest",
            f"--secret={SECRET}",
            f"--project={PROJECT}",
        ],
        text=True,
    ).strip()
    match = re.match(r"^([^:]+):(.*)@unix\([^)]*\)/([^?]+)(?:\?.*)?$", raw)
    if not match:
        raise RuntimeError("unexpected SQL_DSN format")
    user, password, database = match.groups()
    return pymysql.connect(
        host="127.0.0.1",
        port=port,
        user=user,
        password=password,
        database=database,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        read_timeout=30,
        write_timeout=30,
        autocommit=False,
    )


def text(source: dict[str, object], *keys: str) -> str:
    for key in keys:
        value = str(source.get(key) or "").strip()
        if value:
            return value
    return ""


def attribution_envelope(raw: str, fallback_timestamp: int) -> dict[str, object] | None:
    try:
        source = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return None
    click_type = next((key for key in CLICK_ID_TYPES if text(source, key)), "")
    if not click_type:
        return None
    utm = {
        key: text(source, key)
        for key in ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content")
        if text(source, key)
    }
    dimension_keys = {
        "account": ("account", "hsa_acc"),
        "campaign": ("campaign", "utm_campaign"),
        "campaign_id": ("campaign_id", "gad_campaignid", "hsa_cam"),
        "ad_group": ("ad_group", "utm_content"),
        "ad_group_id": ("ad_group_id", "hsa_grp"),
        "creative": ("creative",),
        "creative_id": ("creative_id", "hsa_ad"),
        "placement": ("placement", "hsa_src"),
        "network": ("network", "hsa_net"),
        "device": ("device",),
        "market": ("market", "country"),
        "keyword": ("keyword", "utm_term", "hsa_kw"),
        "match_type": ("match_type", "hsa_mt"),
        "target_id": ("target_id", "hsa_tgt"),
        "location_id": ("location_id", "loc_physical_ms"),
        "language": ("language", "lng"),
        "experiment": ("experiment", "experiment_id"),
    }
    dimensions = {
        key: text(source, *aliases)
        for key, aliases in dimension_keys.items()
        if text(source, *aliases)
    }
    captured_at = text(source, "first_captured_at", "captured_at")
    if not captured_at:
        captured_at = datetime.fromtimestamp(
            fallback_timestamp, tz=timezone.utc
        ).isoformat().replace("+00:00", "Z")
    return {
        "click_id_type": click_type,
        "click_id": text(source, click_type),
        "captured_at": captured_at,
        "landing_path": text(source, "first_landing_path", "landing_path"),
        "utm": utm,
        "dimensions": dimensions,
    }


def pending_repairs(cursor) -> list[dict[str, object]]:
    cursor.execute(
        """
        SELECT t.user_id, t.trade_no, t.money, t.payment_currency,
               t.payment_provider, t.complete_time,
               u.created_at AS user_created_at, u.ads_attribution
          FROM top_ups t
          JOIN users u ON u.id=t.user_id AND u.deleted_at IS NULL
          LEFT JOIN ads_attribution_outboxes o
            ON o.event_id=CONCAT('flatkey:purchase:', t.trade_no)
           AND o.event_type='purchase'
         WHERE t.status='success' AND t.money>0 AND t.complete_time>0
           AND UPPER(COALESCE(t.payment_currency, '')) REGEXP '^[A-Z]{3}$'
           AND JSON_VALID(u.ads_attribution)
           AND LOWER(JSON_UNQUOTE(JSON_EXTRACT(u.ads_attribution, '$.utm_campaign')))=%s
           AND o.id IS NULL
         ORDER BY t.complete_time ASC, t.id ASC
        """,
        (PT_CAMPAIGN,),
    )
    return cursor.fetchall()


def insert_event(cursor, *, event_id: str, event_type: str, user_id: int,
                 order_id: str, payload: dict[str, object], now: int) -> int:
    cursor.execute(
        """
        INSERT IGNORE INTO ads_attribution_outboxes
          (event_id, event_type, user_id, order_id, payload, status,
           attempts, next_attempt_at, claimed_at, delivered_at, last_error,
           created_at, updated_at)
        VALUES (%s,%s,%s,%s,%s,'pending',0,%s,0,0,'',%s,%s)
        """,
        (
            event_id,
            event_type,
            user_id,
            order_id,
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            now,
            now,
            now,
        ),
    )
    return int(cursor.rowcount)


def summarize(rows: list[dict[str, object]]) -> dict[str, object]:
    currency = Counter()
    users = set()
    for row in rows:
        currency[str(row["payment_currency"]).upper()] += float(row["money"])
        users.add(int(row["user_id"]))
    return {
        "eligible_purchases": len(rows),
        "eligible_paid_users": len(users),
        "value_by_currency": {
            key: round(value, 2) for key, value in sorted(currency.items())
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=3307)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    db = production_connection(args.port)
    try:
        with db.cursor() as cursor:
            rows = pending_repairs(cursor)
            plan = summarize(rows)
            invalid = 0
            envelopes: dict[int, dict[str, object]] = {}
            for row in rows:
                user_id = int(row["user_id"])
                envelope = attribution_envelope(
                    row["ads_attribution"], int(row["user_created_at"])
                )
                if not envelope:
                    invalid += 1
                    continue
                envelopes[user_id] = envelope
            plan["eligible_signup_bindings"] = len(envelopes)
            plan["invalid_attribution_rows"] = invalid
            if not args.apply:
                db.rollback()
                print(json.dumps({"mode": "dry-run", "plan": plan}, indent=2))
                return
            if os.environ.get("ADS_MUTATION_APPROVED") != "1":
                raise RuntimeError("mutation blocked: set ADS_MUTATION_APPROVED=1")
            if invalid:
                raise RuntimeError("refusing partial backfill with invalid attribution")

            now = int(time.time())
            inserted_signups = 0
            for user_id, envelope in envelopes.items():
                signup_payload = {
                    "event_id": f"flatkey:signup:{user_id}",
                    "user_id": str(user_id),
                    "occurred_at": datetime.fromtimestamp(
                        next(
                            int(row["user_created_at"])
                            for row in rows
                            if int(row["user_id"]) == user_id
                        ),
                        tz=timezone.utc,
                    ).isoformat().replace("+00:00", "Z"),
                    "attribution": envelope,
                }
                inserted_signups += insert_event(
                    cursor,
                    event_id=signup_payload["event_id"],
                    event_type="signup",
                    user_id=user_id,
                    order_id="",
                    payload=signup_payload,
                    now=now,
                )

            inserted_purchases = 0
            for row in rows:
                user_id = int(row["user_id"])
                if user_id not in envelopes:
                    continue
                occurred_at = datetime.fromtimestamp(
                    int(row["complete_time"]), tz=timezone.utc
                ).isoformat().replace("+00:00", "Z")
                purchase_payload = {
                    "event_type": "purchase",
                    "event_id": "flatkey:purchase:" + row["trade_no"],
                    "user_id": str(user_id),
                    "order_id": row["trade_no"],
                    "value": float(row["money"]),
                    "currency": str(row["payment_currency"]).upper(),
                    "occurred_at": occurred_at,
                    "payment_provider": row["payment_provider"],
                }
                inserted_purchases += insert_event(
                    cursor,
                    event_id=purchase_payload["event_id"],
                    event_type="purchase",
                    user_id=user_id,
                    order_id=row["trade_no"],
                    payload=purchase_payload,
                    now=now + 1,
                )
            db.commit()
            print(
                json.dumps(
                    {
                        "mode": "applied",
                        "plan": plan,
                        "inserted_signup_bindings": inserted_signups,
                        "inserted_purchases": inserted_purchases,
                    },
                    indent=2,
                )
            )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
