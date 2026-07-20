'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock3, Megaphone, RefreshCw } from 'lucide-react'
import { authHeaders } from '@/_hooks/useToken'
import {
  ADS_WIDGET_IDS,
  adsCampaignRows,
  adsMetricValue,
  buildAdsReportPath,
  latestAdsSync,
} from './ads-panel-model.js'
import './AdsPanel.css'

type AdsWidget = {
  id?: string
  data?: {
    value?: number
    rows?: Array<Record<string, unknown>>
  }
}

type AdsReport = {
  report_type?: string
  range?: { from?: string; to?: string }
  widgets?: AdsWidget[]
  synced_at?: string
  generated_at?: string
  updated_at?: string
}

type LoadState = 'loading' | 'ready' | 'disconnected' | 'unauthorized' | 'error'

const METRIC_CARDS = [
  { id: 'spend_usd', label: 'Spend', format: 'usd' },
  { id: 'impressions', label: 'Impressions', format: 'integer' },
  { id: 'link_clicks', label: 'Link Clicks', format: 'integer' },
  { id: 'ctr_percent', label: 'CTR', format: 'percent' },
  { id: 'cpc_usd', label: 'CPC', format: 'usd' },
  { id: 'conversions', label: 'Platform Conversions', format: 'number' },
  { id: 'revenue_usd', label: 'Verified Revenue', format: 'usd' },
  { id: 'roas', label: 'ROAS', format: 'roas' },
] as const

function formatMetric(value: number, format: typeof METRIC_CARDS[number]['format']) {
  if (format === 'usd') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
  }
  if (format === 'integer') return Math.round(value).toLocaleString('en-US')
  if (format === 'percent') return `${value.toFixed(2)}%`
  if (format === 'roas') return `${value.toFixed(2)}×`
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function formatTimestamp(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function statusMeta(status: string) {
  if (['running', 'enabled', 'active', 'servable', 'live'].includes(status)) {
    return { label: '运行中', tone: 'live' }
  }
  if (['paused', 'pending', 'in_review', 'review'].includes(status)) {
    return { label: status === 'paused' ? '已暂停' : '审核中', tone: 'pending' }
  }
  if (['removed', 'disabled', 'stopped', 'ended'].includes(status)) {
    return { label: '已停止', tone: 'stopped' }
  }
  if (status === 'not_servable') return { label: '不可投放', tone: 'stopped' }
  return { label: status && status !== 'unknown' ? status : '未知', tone: 'unknown' }
}

export function AdsPanel({ slug, token }: { slug: string; token: string }) {
  const [report, setReport] = useState<AdsReport | null>(null)
  const [state, setState] = useState<LoadState>('loading')

  const load = useCallback(async (signal?: AbortSignal) => {
    setState('loading')
    try {
      const response = await fetch(buildAdsReportPath(slug), {
        method: 'GET',
        headers: { Accept: 'application/json', ...authHeaders(token) },
        signal,
      })

      if (response.status === 401) {
        setReport(null)
        setState('unauthorized')
        return
      }

      if (response.status === 404) {
        setReport(null)
        setState('disconnected')
        return
      }

      if (!response.ok) throw new Error('ads report unavailable')
      const data = await response.json() as AdsReport
      if (data.report_type !== 'custom') throw new Error('unexpected ads report')
      setReport(data)
      setState('ready')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setReport(null)
      setState('error')
    }
  }, [slug, token])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  const metrics = useMemo(() => Object.fromEntries(
    ADS_WIDGET_IDS.map(id => [id, adsMetricValue(report, id)]),
  ) as Record<string, number>, [report])
  const campaigns = useMemo(() => adsCampaignRows(report), [report])
  const latestSync = useMemo(() => latestAdsSync(report), [report])

  const connectionLabel = state === 'ready'
    ? '已连接'
    : state === 'loading'
      ? '加载中'
      : state === 'disconnected'
        ? '未连接'
        : state === 'unauthorized'
          ? '需要授权'
        : '暂不可用'

  return (
    <section className="ads-panel" aria-label={`${slug} Ads`}>
      <header className="ads-panel-header">
        <div className="ads-panel-heading">
          <span className="ads-panel-icon"><Megaphone size={18} /></span>
          <div>
            <div className="ads-panel-kicker">PAID ACQUISITION · LAST 30 DAYS</div>
            <h1>Ads performance</h1>
            <p>按当前项目隔离展示广告花费、流量、平台转化与已验证收入。</p>
          </div>
        </div>
        <div className="ads-panel-actions">
          <div className="ads-channel-status" aria-live="polite">
            <span className="ads-channel-name">X Ads</span>
            <span className={`ads-connection is-${state}`}>{connectionLabel}</span>
          </div>
          <button className="ads-refresh" type="button" onClick={() => load()} disabled={state === 'loading'}>
            <RefreshCw size={14} className={state === 'loading' ? 'is-spinning' : ''} />
            刷新
          </button>
        </div>
      </header>

      <div className="ads-sync-line">
        <Clock3 size={13} />
        <span>最新同步：{formatTimestamp(latestSync)}</span>
        <span className="ads-sync-separator">·</span>
        <span>数据范围：最近 30 天</span>
      </div>

      {state === 'disconnected' && (
        <div className="ads-empty" role="status">
          <Megaphone size={24} />
          <strong>尚未连接广告数据</strong>
          <span>当前项目还没有 Ads 报表；接入后会在这里自动显示 X Ads Campaign 与转化效果。</span>
        </div>
      )}

      {state === 'error' && (
        <div className="ads-empty is-error" role="alert">
          <strong>广告数据暂时不可用</strong>
          <span>请稍后刷新重试。</span>
        </div>
      )}

      {state === 'unauthorized' && (
        <div className="ads-empty is-error" role="alert">
          <strong>需要 Ads 报表读取权限</strong>
          <span>请在顶部 Sign in 中填入当前 Workspace token。</span>
        </div>
      )}

      {state === 'loading' && (
        <div className="ads-loading" role="status">正在读取 {slug} 的广告数据…</div>
      )}

      {state === 'ready' && (
        <>
          <div className="ads-metric-grid">
            {METRIC_CARDS.map(card => (
              <article className={`ads-metric-card is-${card.id}`} key={card.id}>
                <span>{card.label}</span>
                <strong>{formatMetric(metrics[card.id], card.format)}</strong>
              </article>
            ))}
          </div>

          <section className="ads-campaigns">
            <div className="ads-campaigns-head">
              <div>
                <span>CAMPAIGNS</span>
                <h2>X Ads Campaign 表现</h2>
              </div>
              <strong>{campaigns.length}</strong>
            </div>
            {campaigns.length === 0 ? (
              <div className="ads-table-empty">暂无 Campaign 数据</div>
            ) : (
              <div className="ads-table-wrap">
                <table className="ads-table">
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Channel</th>
                      <th>Status</th>
                      <th>Budget/day</th>
                      <th>Spend</th>
                      <th>Impr.</th>
                      <th>Clicks</th>
                      <th>Platform Conv.</th>
                      <th>Verified Revenue</th>
                      <th>ROAS</th>
                      <th>Last sync</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map(campaign => {
                      const status = statusMeta(campaign.status)
                      return (
                        <tr key={campaign.key}>
                          <td data-label="Campaign">
                            <strong>{campaign.name}</strong>
                            {campaign.externalId && <small>{campaign.externalId}</small>}
                          </td>
                          <td data-label="Channel"><span className="ads-channel-pill">{campaign.channel}</span></td>
                          <td data-label="Status"><span className={`ads-status is-${status.tone}`}>{status.label}</span></td>
                          <td data-label="Budget/day">{formatMetric(campaign.dailyBudget, 'usd')}</td>
                          <td data-label="Spend">{formatMetric(campaign.spend, 'usd')}</td>
                          <td data-label="Impr.">{formatMetric(campaign.impressions, 'integer')}</td>
                          <td data-label="Clicks">{formatMetric(campaign.clicks, 'integer')}</td>
                          <td data-label="Platform Conv.">{formatMetric(campaign.conversions, 'number')}</td>
                          <td data-label="Verified Revenue">{formatMetric(campaign.revenue, 'usd')}</td>
                          <td data-label="ROAS">{formatMetric(campaign.roas, 'roas')}</td>
                          <td data-label="Last sync">{formatTimestamp(campaign.syncedAt)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  )
}
