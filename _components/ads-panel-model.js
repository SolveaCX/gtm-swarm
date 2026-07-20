export const ADS_WIDGET_IDS = [
  'spend_usd',
  'impressions',
  'link_clicks',
  'ctr_percent',
  'cpc_usd',
  'conversions',
  'revenue_usd',
  'roas',
  'campaigns',
]

export const ADS_REPORT_IDENTITY = Object.freeze({
  report_type: 'custom',
  agent_id: 'paid-ads-agent',
  agent_key: 'ads-agent',
  platform: 'paid_ads',
})

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function firstText(values, fallback = '') {
  const value = values.find(candidate => typeof candidate === 'string' && candidate.trim())
  return value ? value.trim() : fallback
}

function metric(row, ...keys) {
  const metrics = row && typeof row.metrics === 'object' && row.metrics ? row.metrics : {}
  for (const key of keys) {
    if (row?.[key] !== undefined && row[key] !== null && row[key] !== '') return finiteNumber(row[key])
    if (metrics[key] !== undefined && metrics[key] !== null && metrics[key] !== '') return finiteNumber(metrics[key])
  }
  return 0
}

export function buildAdsReportPath(workspace, now = new Date()) {
  const to = new Date(now)
  if (Number.isNaN(to.getTime())) throw new TypeError('now must be a valid date')
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - 30)

  const params = new URLSearchParams({
    workspace: String(workspace || '').trim(),
    ...ADS_REPORT_IDENTITY,
    from: from.toISOString(),
    to: to.toISOString(),
  })
  return `/api/swarm/report?${params.toString()}`
}

export function adsWidgetMap(report) {
  const widgets = Array.isArray(report?.widgets) ? report.widgets : []
  return new Map(widgets.map(widget => [widget?.id, widget]))
}

export function adsMetricValue(report, id) {
  const widgets = adsWidgetMap(report)
  const value = metricId => finiteNumber(widgets.get(metricId)?.data?.value)
  const spend = value('spend_usd')
  const impressions = value('impressions')
  const clicks = value('link_clicks')
  const verifiedRevenue = value('revenue_usd')

  if (id === 'ctr_percent') return impressions > 0 ? clicks / impressions * 100 : 0
  if (id === 'cpc_usd') return clicks > 0 ? spend / clicks : 0
  if (id === 'roas') return spend > 0 ? verifiedRevenue / spend : 0
  return value(id)
}

function channelLabel(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (!normalized || normalized === 'x' || normalized === 'twitter' || normalized === 'x ads' || normalized === 'twitter ads') {
    return 'X Ads'
  }
  if (normalized.includes('google')) return 'Google Ads'
  if (normalized.includes('meta') || normalized.includes('facebook') || normalized.includes('instagram')) return 'Meta Ads'
  if (normalized.includes('apple')) return 'Apple Search Ads'
  if (normalized.includes('tiktok')) return 'TikTok Ads'
  return String(value).trim()
}

export function adsCampaignRows(report) {
  const rows = adsWidgetMap(report).get('campaigns')?.data?.rows
  if (!Array.isArray(rows)) return []

  return rows.map((row, index) => {
    const impressions = metric(row, 'impressions')
    const clicks = metric(row, 'link_clicks', 'clicks')
    const spend = metric(row, 'spend_usd', 'cost_usd', 'spend')
    const conversions = metric(row, 'conversions')
    const revenue = metric(row, 'revenue_usd')
    const rawStatus = firstText([row?.status, row?.campaign_status, row?.delivery_status, row?.state], 'unknown').toLowerCase()
    const servable = typeof row?.servable === 'boolean' ? row.servable : null

    return {
      key: firstText([row?.artifact_id, row?.campaign_external_id, row?.external_id, row?.id], `campaign-${index}`),
      name: firstText([row?.campaign_name, row?.name, row?.title, row?.label, row?.external_id], 'Unnamed campaign'),
      externalId: firstText([row?.campaign_external_id, row?.external_id, row?.campaign_id, row?.id]),
      channel: channelLabel(firstText([row?.channel, row?.ad_platform, row?.network, row?.platform])),
      status: servable === false && ['running', 'enabled', 'active', 'live'].includes(rawStatus)
        ? 'not_servable'
        : rawStatus,
      servable,
      dailyBudget: metric(row, 'daily_budget_usd'),
      spend,
      impressions,
      clicks,
      ctr: impressions > 0 ? clicks / impressions * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      conversions,
      revenue,
      roas: spend > 0 ? revenue / spend : 0,
      syncedAt: firstText([row?.synced_at, row?.observed_at, row?.updated_at, row?.source_time]),
    }
  })
}

export function latestAdsSync(report) {
  const candidates = [
    report?.synced_at,
    report?.generated_at,
    report?.updated_at,
    ...adsCampaignRows(report).map(row => row.syncedAt),
  ]

  const timestamps = candidates
    .map(value => Date.parse(String(value || '')))
    .filter(Number.isFinite)

  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : ''
}
