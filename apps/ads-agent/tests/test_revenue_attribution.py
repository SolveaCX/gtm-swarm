import importlib.util
from pathlib import Path
import unittest


PATH = Path(__file__).parents[1] / "runtime" / "revenue_attribution.py"
SPEC = importlib.util.spec_from_file_location("revenue_attribution", PATH)
ATTRIBUTION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ATTRIBUTION)


class RevenueAttributionTest(unittest.TestCase):
    def purchase(self, **overrides):
        event = {
            "event_type": "purchase",
            "event_id": "evt_1",
            "order_id": "pi_1",
            "google_customer_id": "275-229-9046",
            "conversion_action": "123456789",
            "click_id_type": "gclid",
            "click_id": "CLICK_123456",
            "occurred_at": "2026-07-20T22:10:00Z",
            "conversion_timezone": "America/Los_Angeles",
            "value": 49.5,
            "currency": "USD",
        }
        event.update(overrides)
        return event

    def test_purchase_uses_real_value_and_click_id(self):
        payload = ATTRIBUTION.build_click_conversion_payload(self.purchase())
        self.assertEqual(payload["customer_id"], "2752299046")
        self.assertEqual(payload["conversion_action"], "customers/2752299046/conversionActions/123456789")
        self.assertEqual(payload["click_id_type"], "gclid")
        self.assertEqual(payload["click_id"], "CLICK_123456")
        self.assertEqual(payload["conversion_value"], 49.5)
        self.assertEqual(payload["currency_code"], "USD")
        self.assertTrue(payload["conversion_date_time"].endswith("-07:00"))

    def test_ios_click_ids_are_supported(self):
        for click_type in ("gbraid", "wbraid"):
            payload = ATTRIBUTION.build_click_conversion_payload(
                self.purchase(click_id_type=click_type)
            )
            self.assertEqual(payload["click_id_type"], click_type)

    def test_full_refund_is_retraction(self):
        payload = ATTRIBUTION.build_conversion_adjustment_payload({
            **self.purchase(),
            "event_type": "refund",
            "adjustment_type": "retraction",
        })
        self.assertEqual(payload["adjustment_type"], "retraction")
        self.assertNotIn("adjusted_value", payload)

    def test_partial_refund_is_restatement_of_net_value(self):
        payload = ATTRIBUTION.build_conversion_adjustment_payload({
            **self.purchase(),
            "event_type": "refund",
            "adjustment_type": "restatement",
            "adjusted_value": 39.5,
        })
        self.assertEqual(payload["adjustment_type"], "restatement")
        self.assertEqual(payload["adjusted_value"], 39.5)
        self.assertEqual(payload["currency_code"], "USD")

    def test_conversion_action_must_belong_to_customer(self):
        with self.assertRaisesRegex(ValueError, "does not belong"):
            ATTRIBUTION.build_click_conversion_payload(self.purchase(
                conversion_action="customers/9999999999/conversionActions/123"
            ))


if __name__ == "__main__":
    unittest.main()
