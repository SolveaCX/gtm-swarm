"""Google Ads offline revenue uploads for the shared Ads Agent runtime.

The platform owns attribution state and idempotency. This module only converts a
claimed tenant-scoped event into the Google Ads API shape and uploads it. Live
calls require both ARMED=1 and ENABLE_REVENUE_UPLOADS=1 in executor.py.
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


CLICK_ID_TYPES = ("gclid", "gbraid", "wbraid")


def _text(value, name, limit=512):
    text = str(value or "").strip()
    if not text:
        raise ValueError("%s required" % name)
    if len(text) > limit:
        raise ValueError("%s too long" % name)
    return text


def customer_id(value):
    normalized = _text(value, "google_customer_id", 32).replace("-", "")
    if not normalized.isdigit():
        raise ValueError("google_customer_id invalid")
    return normalized


def conversion_action_resource(value, cid):
    action = _text(value, "conversion_action", 160)
    if action.isdigit():
        return "customers/%s/conversionActions/%s" % (cid, action)
    prefix = "customers/%s/conversionActions/" % cid
    if not action.startswith(prefix) or not action[len(prefix):].isdigit():
        raise ValueError("conversion_action does not belong to google_customer_id")
    return action


def google_datetime(value, timezone_name="UTC"):
    text = _text(value, "occurred_at", 80)
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    localized = parsed.astimezone(ZoneInfo(timezone_name or "UTC"))
    return localized.strftime("%Y-%m-%d %H:%M:%S%z")[:-2] + ":" + localized.strftime("%z")[-2:]


def build_click_conversion_payload(event):
    cid = customer_id(event.get("google_customer_id"))
    click_type = _text(event.get("click_id_type"), "click_id_type", 16).lower()
    if click_type not in CLICK_ID_TYPES:
        raise ValueError("click_id_type invalid")
    value = float(event.get("value") or 0)
    if value < 0:
        raise ValueError("conversion value must not be negative")
    currency = str(event.get("currency") or "").upper()
    event_type = str(event.get("event_type") or "")
    if event_type == "purchase" and (len(currency) != 3 or not currency.isalpha()):
        raise ValueError("purchase currency invalid")
    return {
        "customer_id": cid,
        "conversion_action": conversion_action_resource(event.get("conversion_action"), cid),
        "click_id_type": click_type,
        "click_id": _text(event.get("click_id"), "click_id"),
        "conversion_date_time": google_datetime(event.get("occurred_at"), event.get("conversion_timezone") or "UTC"),
        "conversion_value": value,
        "currency_code": currency if event_type == "purchase" else "",
        "order_id": _text(event.get("order_id") or event.get("event_id"), "order_id", 200),
    }


def build_conversion_adjustment_payload(event):
    cid = customer_id(event.get("google_customer_id"))
    adjustment_type = _text(event.get("adjustment_type"), "adjustment_type", 20).lower()
    if adjustment_type not in ("retraction", "restatement"):
        raise ValueError("adjustment_type invalid")
    payload = {
        "customer_id": cid,
        "conversion_action": conversion_action_resource(event.get("conversion_action"), cid),
        "order_id": _text(event.get("order_id"), "order_id", 200),
        "adjustment_type": adjustment_type,
        "adjustment_date_time": google_datetime(event.get("occurred_at"), event.get("conversion_timezone") or "UTC"),
    }
    if adjustment_type == "restatement":
        adjusted = float(event.get("adjusted_value"))
        currency = str(event.get("currency") or "").upper()
        if adjusted < 0 or len(currency) != 3 or not currency.isalpha():
            raise ValueError("restatement value/currency invalid")
        payload["adjusted_value"] = adjusted
        payload["currency_code"] = currency
    return payload


def _partial_failure(response):
    failure = getattr(response, "partial_failure_error", None)
    code = getattr(failure, "code", 0) if failure is not None else 0
    message = getattr(failure, "message", "") if failure is not None else ""
    if code:
        raise RuntimeError("Google Ads partial failure: %s" % message[:500])


def upload_conversion_event(client, event):
    """Upload one idempotent purchase/signup or refund adjustment."""
    event_type = str(event.get("event_type") or "").lower()
    service = client.get_service("ConversionUploadService")
    if event_type in ("signup", "purchase"):
        payload = build_click_conversion_payload(event)
        conversion = client.get_type("ClickConversion")
        conversion.conversion_action = payload["conversion_action"]
        setattr(conversion, payload["click_id_type"], payload["click_id"])
        conversion.conversion_date_time = payload["conversion_date_time"]
        conversion.conversion_value = payload["conversion_value"]
        if payload["currency_code"]:
            conversion.currency_code = payload["currency_code"]
        conversion.order_id = payload["order_id"]
        response = service.upload_click_conversions(
            customer_id=payload["customer_id"], conversions=[conversion], partial_failure=True
        )
        _partial_failure(response)
        return {
            "kind": "click_conversion",
            "event_type": event_type,
            "order_id": payload["order_id"],
            "uploaded_value": payload["conversion_value"],
            "currency": payload["currency_code"],
            "conversion_date_time": payload["conversion_date_time"],
        }
    if event_type == "refund":
        payload = build_conversion_adjustment_payload(event)
        adjustment = client.get_type("ConversionAdjustment")
        adjustment.conversion_action = payload["conversion_action"]
        adjustment.order_id = payload["order_id"]
        adjustment.adjustment_date_time = payload["adjustment_date_time"]
        enum = client.enums.ConversionAdjustmentTypeEnum
        adjustment.adjustment_type = enum.RETRACTION if payload["adjustment_type"] == "retraction" else enum.RESTATEMENT
        if payload["adjustment_type"] == "restatement":
            adjustment.restatement_value.adjusted_value = payload["adjusted_value"]
            adjustment.restatement_value.currency_code = payload["currency_code"]
        response = service.upload_conversion_adjustments(
            customer_id=payload["customer_id"], conversion_adjustments=[adjustment], partial_failure=True
        )
        _partial_failure(response)
        return {
            "kind": "conversion_adjustment",
            "adjustment_type": payload["adjustment_type"],
            "order_id": payload["order_id"],
            "uploaded_value": payload.get("adjusted_value"),
            "currency": payload.get("currency_code", ""),
            "adjustment_date_time": payload["adjustment_date_time"],
        }
    raise ValueError("unsupported conversion event_type: %s" % event_type)
