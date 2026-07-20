import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest


PATH = Path(__file__).parents[1] / "runtime" / "x_ads_sync.py"
SPEC = importlib.util.spec_from_file_location("x_ads_sync", PATH)
X_ADS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(X_ADS)


NOW = datetime(2026, 7, 20, 18, 15, tzinfo=timezone.utc)


class FakeApi:
    def __init__(self, config, metrics=None):
        self.config = config
        self.metrics = metrics if metrics is not None else {
            "impressions": [None, 100],
            "link_clicks": [5],
            "billed_charge_local_micro": [2_500_000],
            "conversion_purchases": [2],
            "conversion_purchases_value": [5_000_000],
        }
        self.calls = []

    def __call__(self, path, params=None):
        self.calls.append((path, params))
        if "/campaigns/" in path:
            return {
                "data": {
                    "id": self.config["campaign_id"],
                    "name": self.config.get("campaign_name") or "Campaign",
                    "effective_status": "RUNNING",
                    "servable": True,
                }
            }
        if "/line_items/" in path:
            return {
                "data": {
                    "id": self.config["line_item_id"],
                    "daily_budget_amount_local_micro": 10_000_000,
                }
            }
        if params and params.get("entity") == "CAMPAIGN":
            return {
                "data": [{
                    "id": self.config["campaign_id"],
                    "id_data": [{"metrics": self.metrics}],
                }]
            }
        if params and params.get("entity") == "PROMOTED_TWEET":
            return {
                "data": [
                    {"id": item, "id_data": [{"metrics": {}}]}
                    for item in self.config["promoted_tweet_ids"]
                ]
            }
        raise AssertionError(f"unexpected API request: {path} {params}")


class FakeResponse:
    status_code = 200

    def json(self):
        return {
            "ok": True,
            "artifacts": {"upserted": 1},
            "observations": {"inserted": 1},
        }


class XAdsSyncTest(unittest.TestCase):
    def config(self, workspace="pricing-analyse", campaign="ozls7"):
        return {
            "workspace": workspace,
            "project_display_name": "flatkey",
            "account_id": "18ce55vkf9a",
            "campaign_id": campaign,
            "campaign_name": f"campaign-{campaign}",
            "line_item_id": f"line-{campaign}",
            "promoted_tweet_ids": [f"tweet-{campaign}"],
            "country": "US",
            "language": "en",
            "daily_budget_usd": 10,
            "start_time": "2026-07-19T17:00:00Z",
        }

    def write_config(self, directory, config, name="x-ads.json"):
        path = Path(directory) / name
        path.write_text(json.dumps(config), encoding="utf-8")
        return path

    def test_cross_workspace_configs_stay_isolated(self):
        with tempfile.TemporaryDirectory() as directory:
            first_path = self.write_config(
                directory, self.config("pricing-analyse", "campaign-a"), "first.json"
            )
            second_path = self.write_config(
                directory, self.config("voc-ai", "campaign-b"), "second.json"
            )
            first = X_ADS.load_config(first_path)
            second = X_ADS.load_config(second_path)
            first_batch = X_ADS.collect_batch(first, FakeApi(first), now=NOW)
            second_batch = X_ADS.collect_batch(second, FakeApi(second), now=NOW)

        self.assertEqual(first_batch["workspace"], "pricing-analyse")
        self.assertEqual(second_batch["workspace"], "voc-ai")
        self.assertEqual(first_batch["artifacts"][0]["external_id"], "campaign-a")
        self.assertEqual(second_batch["artifacts"][0]["external_id"], "campaign-b")
        self.assertEqual(first_batch["agent_id"], X_ADS.AGENT_ID)
        self.assertEqual(second_batch["agent_key"], X_ADS.AGENT_KEY)

        env = {
            "GTM_SWARM_TOKEN_PRICING_ANALYSE": "token-a",
            "GTM_SWARM_TOKEN_VOC_AI": "token-b",
        }
        no_keychain = lambda service: self.fail(f"unexpected Keychain read: {service}")
        self.assertEqual(X_ADS.load_workspace_token(first, env, no_keychain), "token-a")
        self.assertEqual(X_ADS.load_workspace_token(second, env, no_keychain), "token-b")

    def test_credentials_do_not_enter_batch(self):
        secrets = {
            "X_ADS_API_KEY": "api-key-secret-value",
            "X_ADS_API_SECRET": "api-secret-value",
            "X_ADS_ACCESS_TOKEN": "access-token-value",
            "X_ADS_ACCESS_TOKEN_SECRET": "access-token-secret-value",
        }
        credentials = X_ADS.load_oauth_credentials(
            environ=secrets,
            keychain_reader=lambda service: self.fail(f"unexpected Keychain read: {service}"),
        )
        config = X_ADS.load_config(
            Path(__file__).parents[1] / "products" / "flatkey" / "x-ads.json"
        )
        batch = X_ADS.collect_batch(config, FakeApi(config), now=NOW)
        encoded = json.dumps(batch, sort_keys=True)

        for value in credentials.values():
            self.assertNotIn(value, encoded)
        for forbidden in X_ADS.FORBIDDEN_CONFIG_KEYS:
            self.assertNotIn(f'"{forbidden}"', encoded)

    def test_inline_credentials_are_rejected(self):
        for key in (
            "access_token",
            "x_api_key",
            "openaiApiKey",
            "aws_secret_access_key",
            "session_token",
        ):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                config = self.config()
                config[key] = "must-not-live-in-json"
                path = self.write_config(directory, config)
                with self.assertRaisesRegex(X_ADS.ConfigError, "must not contain credentials"):
                    X_ADS.load_config(path)

    def test_non_secret_token_metadata_is_allowed(self):
        with tempfile.TemporaryDirectory() as directory:
            config = self.config()
            config["token_count"] = 10
            path = self.write_config(directory, config)
            self.assertEqual(X_ADS.load_config(path)["workspace"], "pricing-analyse")

    def test_null_metrics_are_normalized_to_zero(self):
        config = X_ADS.load_config(
            Path(__file__).parents[1] / "products" / "flatkey" / "x-ads.json"
        )
        null_metrics = {
            "impressions": [None],
            "link_clicks": None,
            "url_clicks": [None],
            "billed_charge_local_micro": [None],
            "conversion_purchases": None,
            "conversion_purchases_value": [None],
        }
        batch = X_ADS.collect_batch(config, FakeApi(config, null_metrics), now=NOW)
        self.assertEqual(
            batch["observations"][0]["metrics"],
            {name: 0 for name in X_ADS.METRIC_NAMES},
        )

    def test_metrics_and_dashboard_contract(self):
        config = X_ADS.load_config(
            Path(__file__).parents[1] / "products" / "flatkey" / "x-ads.json"
        )
        api = FakeApi(config)
        batch = X_ADS.collect_batch(config, api, now=NOW)
        metrics = batch["observations"][0]["metrics"]
        self.assertEqual(metrics["spend_usd"], 2.5)
        self.assertEqual(metrics["impressions"], 100)
        self.assertEqual(metrics["link_clicks"], 5)
        self.assertEqual(metrics["ctr_percent"], 5)
        self.assertEqual(metrics["cpc_usd"], 0.5)
        self.assertEqual(metrics["conversions"], 2)
        # X's platform conversion value is not verified realized revenue.
        self.assertEqual(api.metrics["conversion_purchases_value"], [5_000_000])
        self.assertEqual(metrics["revenue_usd"], 0)
        self.assertEqual(metrics["roas"], 0)
        self.assertNotIn("conversion_purchases_value", json.dumps(batch))
        self.assertEqual(batch["agent_id"], "paid-ads-agent")
        self.assertEqual(batch["agent_key"], "ads-agent")
        self.assertEqual(batch["observations"][0]["platform"], "paid_ads")

        widgets = batch["dashboard_spec"]["widgets"]
        self.assertEqual(
            [widget["id"] for widget in widgets[:-1]], list(X_ADS.METRIC_NAMES)
        )
        self.assertEqual(len(widgets[:-1]), 8)
        widget_by_id = {widget["id"]: widget for widget in widgets[:-1]}
        for metric in X_ADS.ADDITIVE_METRICS:
            self.assertEqual(
                widget_by_id[metric]["query"]["kind"], "latest_metric_sum"
            )
            self.assertEqual(widget_by_id[metric]["query"]["metric"], metric)
        self.assertEqual(
            widget_by_id["ctr_percent"]["query"],
            {
                "kind": "latest_metric_ratio",
                "platform": "paid_ads",
                "artifact_type": "campaign",
                "numerator_metric": "link_clicks",
                "denominator_metric": "impressions",
                "multiplier": 100,
            },
        )
        self.assertEqual(
            widget_by_id["cpc_usd"]["query"]["numerator_metric"], "spend_usd"
        )
        self.assertEqual(
            widget_by_id["cpc_usd"]["query"]["denominator_metric"],
            "link_clicks",
        )
        self.assertEqual(
            widget_by_id["roas"]["query"]["numerator_metric"], "revenue_usd"
        )
        self.assertEqual(
            widget_by_id["roas"]["query"]["denominator_metric"], "spend_usd"
        )
        revenue_widget = next(widget for widget in widgets if widget["id"] == "revenue_usd")
        self.assertEqual(revenue_widget["title"], "Verified Revenue")
        self.assertEqual(widgets[-1]["id"], "campaigns")
        self.assertEqual(widgets[-1]["type"], "leaderboard")
        self.assertIn("not connected yet", batch["dashboard_spec"]["description"])

    def test_stats_window_is_last_30_days_capped_by_campaign_start(self):
        old_config = self.config()
        old_config["start_time"] = "2026-05-01T00:00:00Z"
        with tempfile.TemporaryDirectory() as directory:
            old_path = self.write_config(directory, old_config, "old.json")
            recent_path = self.write_config(directory, self.config(), "recent.json")
            old_loaded = X_ADS.load_config(old_path)
            recent_loaded = X_ADS.load_config(recent_path)
            old_api = FakeApi(old_loaded)
            recent_api = FakeApi(recent_loaded)
            X_ADS.collect_batch(old_loaded, old_api, now=NOW)
            X_ADS.collect_batch(recent_loaded, recent_api, now=NOW)

        old_stats = next(
            params
            for _, params in old_api.calls
            if params and params.get("entity") == "CAMPAIGN"
        )
        recent_stats = next(
            params
            for _, params in recent_api.calls
            if params and params.get("entity") == "CAMPAIGN"
        )
        self.assertEqual(old_stats["start_time"], "2026-06-20T18:00:00Z")
        self.assertEqual(old_stats["end_time"], "2026-07-20T19:00:00Z")
        self.assertEqual(recent_stats["start_time"], "2026-07-19T17:00:00Z")

    def test_default_run_does_not_post_or_load_workspace_token(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_config(directory, self.config())
            config = X_ADS.load_config(path)
            output = []

            def fail_post(*args, **kwargs):
                self.fail("default run must not POST")

            def fail_keychain(service):
                self.fail(f"default run must not read workspace token: {service}")

            summary, _ = X_ADS.run(
                path,
                push=False,
                api_get=FakeApi(config),
                post=fail_post,
                keychain_reader=fail_keychain,
                now=NOW,
                printer=output.append,
            )

        self.assertFalse(summary["pushed"])
        self.assertEqual(len(output), 1)
        self.assertNotIn("Authorization", output[0])

    def test_push_uses_scoped_keychain_token_and_safe_output(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_config(directory, self.config())
            config = X_ADS.load_config(path)
            captured = {}
            output = []

            def keychain(service, account):
                self.assertEqual(
                    service, "gtm-swarm-workspace-token"
                )
                self.assertEqual(account, "pricing-analyse")
                return "workspace-secret-value"

            def post(url, **kwargs):
                captured["url"] = url
                captured.update(kwargs)
                return FakeResponse()

            summary, batch = X_ADS.run(
                path,
                push=True,
                environ={},
                keychain_reader=keychain,
                api_get=FakeApi(config),
                post=post,
                now=NOW,
                printer=output.append,
            )

        self.assertEqual(captured["url"], X_ADS.GTM_INGEST_URL)
        self.assertEqual(
            captured["headers"]["Authorization"], "Bearer workspace-secret-value"
        )
        self.assertIs(captured["json"], batch)
        self.assertTrue(summary["pushed"])
        self.assertNotIn("workspace-secret-value", output[0])
        self.assertEqual(summary["ingest"]["observations_inserted"], 1)


if __name__ == "__main__":
    unittest.main()
