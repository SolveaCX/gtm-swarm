import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  ADS_REPORT_IDENTITY,
  ADS_WIDGET_IDS,
  adsCampaignRows,
  adsMetricValue,
  buildAdsReportPath,
  latestAdsSync,
} from '../_components/ads-panel-model.js'

const dashboard = readFileSync(path.join(process.cwd(), 'app/dashboard/[slug]/page.tsx'), 'utf8')
const tabBar = readFileSync(path.join(process.cwd(), '_components/TabBar.tsx'), 'utf8')
const panel = readFileSync(path.join(process.cwd(), '_components/AdsPanel.tsx'), 'utf8')
const bindModal = readFileSync(path.join(process.cwd(), '_components/BindWorkspaceModal.tsx'), 'utf8')

test('Ads is a normal dashboard tab for every workspace', () => {
  assert.match(tabBar, /key: 'ads'.*label: 'Ads'/)
  assert.match(tabBar, /ads: number \| null/)
  assert.match(dashboard, /ads: null/)
  assert.match(dashboard, /tab === 'ads'/)
  assert.match(dashboard, /<AdsPanel slug=\{slug\} token=\{token\} \/>/)
  assert.doesNotMatch(tabBar, /flatkey|voc-ai|solvea/)
})

test('Ads report request is isolated by the current slug and fixed report identity', () => {
  const url = new URL(buildAdsReportPath('tenant project', new Date('2026-07-20T12:30:00.000Z')), 'https://example.test')
  assert.equal(url.pathname, '/api/swarm/report')
  assert.equal(url.searchParams.get('workspace'), 'tenant project')
  assert.equal(url.searchParams.get('report_type'), ADS_REPORT_IDENTITY.report_type)
  assert.equal(url.searchParams.get('agent_id'), ADS_REPORT_IDENTITY.agent_id)
  assert.equal(url.searchParams.get('agent_key'), ADS_REPORT_IDENTITY.agent_key)
  assert.equal(url.searchParams.get('platform'), ADS_REPORT_IDENTITY.platform)
  assert.equal(url.searchParams.get('from'), '2026-06-20T12:30:00.000Z')
  assert.equal(url.searchParams.get('to'), '2026-07-20T12:30:00.000Z')
  assert.deepEqual([...url.searchParams.keys()].sort(), [
    'agent_id', 'agent_key', 'from', 'platform', 'report_type', 'to', 'workspace',
  ])
})

test('Ads panel declares all core paid acquisition widgets', () => {
  assert.deepEqual(ADS_WIDGET_IDS, [
    'spend_usd',
    'impressions',
    'link_clicks',
    'ctr_percent',
    'cpc_usd',
    'conversions',
    'revenue_usd',
    'roas',
    'campaigns',
  ])

  const report = { widgets: [{ id: 'spend_usd', data: { value: 10.25 } }] }
  assert.equal(adsMetricValue(report, 'spend_usd'), 10.25)
  assert.equal(adsMetricValue(report, 'revenue_usd'), 0)
  assert.match(panel, /Platform Conversions/)
  assert.match(panel, /Verified Revenue/)
})

test('Ads summary ratios are derived from aggregate components instead of campaign ratio widgets', () => {
  const report = {
    widgets: [
      { id: 'spend_usd', data: { value: 100 } },
      { id: 'impressions', data: { value: 1000 } },
      { id: 'link_clicks', data: { value: 55 } },
      { id: 'revenue_usd', data: { value: 130 } },
      { id: 'ctr_percent', data: { value: 7.5 } },
      { id: 'cpc_usd', data: { value: 1.5 } },
      { id: 'roas', data: { value: 2.5 } },
    ],
  }

  assert.equal(adsMetricValue(report, 'ctr_percent'), 5.5)
  assert.equal(adsMetricValue(report, 'cpc_usd'), 100 / 55)
  assert.equal(adsMetricValue(report, 'roas'), 1.3)
})

test('Campaign view exposes only display fields and derives status metrics safely', () => {
  const report = {
    widgets: [{
      id: 'campaigns',
      data: {
        rows: [{
          artifact_id: 'artifact-1',
          external_id: 'campaign-1',
          title: 'US English',
          channel: 'x',
          status: 'RUNNING',
          servable: true,
          daily_budget_usd: 10,
          observed_at: '2026-07-20T11:00:00.000Z',
          metrics: {
            spend_usd: 10,
            impressions: 1000,
            link_clicks: 20,
            conversions: 2,
            revenue_usd: 30,
            conversion_value_usd: 9999,
            roas: 999,
          },
          api_key: 'top-secret',
          workspace_token: 'top-secret',
          client_secret: 'top-secret',
          payload: { authorization: 'top-secret' },
        }],
      },
    }],
  }

  const [campaign] = adsCampaignRows(report)
  assert.equal(campaign.channel, 'X Ads')
  assert.equal(campaign.status, 'running')
  assert.equal(campaign.servable, true)
  assert.equal(campaign.dailyBudget, 10)
  assert.equal(campaign.ctr, 2)
  assert.equal(campaign.cpc, 0.5)
  assert.equal(campaign.roas, 3)
  assert.equal(latestAdsSync(report), '2026-07-20T11:00:00.000Z')
  assert.doesNotMatch(JSON.stringify(campaign), /top-secret|api_key|workspace_token|client_secret|authorization/)
})

test('Campaign status does not claim delivery when the platform marks it unservable', () => {
  const report = {
    widgets: [{
      id: 'campaigns',
      data: { rows: [{ external_id: 'blocked', status: 'RUNNING', servable: false }] },
    }],
  }

  const [campaign] = adsCampaignRows(report)
  assert.equal(campaign.status, 'not_servable')
})

test('Campaign rows never treat platform-reported conversion value as verified revenue', () => {
  const report = {
    widgets: [{
      id: 'campaigns',
      data: {
        rows: [{
          external_id: 'unverified-campaign',
          metrics: {
            spend_usd: 25,
            conversion_value_usd: 500,
            revenue: 600,
            roas: 24,
          },
        }],
      },
    }],
  }

  const [campaign] = adsCampaignRows(report)
  assert.equal(campaign.revenue, 0)
  assert.equal(campaign.roas, 0)
})

test('Ads panel handles unconnected projects without requesting sensitive workspace data', () => {
  assert.match(panel, /fetch\(buildAdsReportPath\(slug\)/)
  assert.match(panel, /response\.status === 404/)
  assert.match(panel, /尚未连接广告数据/)
  assert.match(panel, /X Ads/)
  assert.match(panel, /最新同步/)
  assert.doesNotMatch(panel, /\/api\/workspaces|daily-status|swarm_token|workspace_token|api[_-]?key|client_secret|authorization|bearer/i)
})

test('an unbound project can enter the read-only Ads tab without binding Multica', () => {
  assert.match(dashboard, /multica_workspace_slug == null && tab !== 'ads'/)
  assert.match(dashboard, /onViewAds=\{\(\) => setTab\('ads'\)\}/)
  assert.match(bindModal, /先查看 Ads/)
})
