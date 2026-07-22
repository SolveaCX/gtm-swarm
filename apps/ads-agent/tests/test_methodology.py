import importlib.util
from pathlib import Path
import unittest


PATH = Path(__file__).parents[1] / "runtime" / "methodology.py"
SPEC = importlib.util.spec_from_file_location("ads_methodology", PATH)
methodology = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(methodology)


class MethodologyTest(unittest.TestCase):
    def test_derives_metrics_from_raw_counts(self):
        row = methodology.normalize_dimension_row({
            "campaign": "A", "spend": 50, "impressions": 1000, "clicks": 100,
            "conversions": 10, "revenue": 125,
        })
        self.assertEqual(row["ctr"], 10)
        self.assertEqual(row["cpc"], 0.5)
        self.assertEqual(row["cvr"], 10)
        self.assertEqual(row["cpa"], 5)
        self.assertEqual(row["roas"], 2.5)
        self.assertEqual(row["profit"], 75)

    def test_blocks_scale_when_real_revenue_or_attribution_is_missing(self):
        result = methodology.build_methodology({
            "today": {"cost": 50, "impr": 1000, "clicks": 100, "ctr": 10, "cpc": 0.5},
            "revenue": {"real_usd": None, "real_roas": None},
        }, channel="google", dimensions=[])
        self.assertEqual(result["stages"][-1]["status"], "unknown")
        self.assertIn("真实收入归因", result["recommendations"][0]["action"])
        self.assertFalse(result["data_quality"]["tracking_ready"])
        self.assertFalse(result["data_quality"]["revenue_reconciled"])

    def test_offer_passes_only_on_reconciled_roas(self):
        result = methodology.build_methodology({
            "today": {"cost": 20, "impr": 100, "clicks": 10, "ctr": 10, "cpc": 2},
            "revenue": {"real_usd": 60, "real_roas": 3},
            "attribution_ready": True,
            "raw_checked_at": "2026-07-21T12:00:00Z",
        }, channel="meta", target_roas=2, dimensions=[{
            "creative": "c1", "angle": "a1", "lander": "lp1", "spend": 20,
            "impressions": 100, "clicks": 10, "conversions": 2, "revenue": 60,
            "lp_ctr": 12, "lp_epc": 0.4,
        }])
        self.assertEqual(result["stages"][-1]["status"], "pass")
        self.assertTrue(result["data_quality"]["tracking_ready"])
        self.assertTrue(result["data_quality"]["revenue_reconciled"])


if __name__ == "__main__":
    unittest.main()
