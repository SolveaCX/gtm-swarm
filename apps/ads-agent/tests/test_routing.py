import importlib.util
from pathlib import Path
import unittest


def load_runtime(name):
    path = Path(__file__).parents[1] / "runtime" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CampaignRoutingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.executor = load_runtime("executor")
        cls.telemetry = load_runtime("push_daily_stats")

    def assert_route(self, campaign, expected):
        self.assertEqual(self.executor.project_of(campaign), expected)
        self.assertEqual(self.telemetry.project_of(campaign), expected)

    def test_known_prefixes(self):
        self.assert_route("VOC-Agent-Category-US", "voc")
        self.assert_route("flatkey-US-search", "flatkey")
        self.assert_route("FK-HighIntent-US", "flatkey")
        self.assert_route("SOLVEA-App-US", "solvea")
        self.assert_route("GADS-US-App-Business-Phone", "solvea")

    def test_unknown_is_not_solvea(self):
        self.assert_route("unowned-campaign", None)

    def test_resume_requires_separate_enable_gate(self):
        old_armed = self.executor.ARMED
        old_allow_enable = self.executor.ALLOW_ENABLE
        self.executor.ARMED = True
        self.executor.ALLOW_ENABLE = False
        try:
            with self.assertRaisesRegex(RuntimeError, "ALLOW_ENABLE=1"):
                self.executor.execute(None, {"params": {"op": "resume"}})
        finally:
            self.executor.ARMED = old_armed
            self.executor.ALLOW_ENABLE = old_allow_enable


if __name__ == "__main__":
    unittest.main()
