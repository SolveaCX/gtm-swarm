'use client'
import {
  LayoutDashboard,
  TrendingUp,
  BarChart3,
  BookOpen,
  Lightbulb,
  FileText,
  Eye,
  Archive,
  Send,
  Megaphone,
} from 'lucide-react'
import './TabBar.css'

export type TabKey = 'overview' | 'north-star' | 'reports' | 'ads' | 'ledger' | 'ideas' | 'drafts' | 'review' | 'bank' | 'published'

type Counts = {
  overview: number | null
  'north-star': number | null
  reports: number | null
  ads: number | null
  ledger: number | null
  ideas: number | null
  drafts: number | null
  review: number | null
  bank: number | null
  published: number | null
}

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'overview',   icon: <LayoutDashboard size={15} />, label: 'Overview' },
  { key: 'north-star', icon: <TrendingUp size={15} />,      label: 'North Star' },
  { key: 'reports',    icon: <BarChart3 size={15} />,       label: 'Reports' },
  { key: 'ads',        icon: <Megaphone size={15} />,       label: 'Ads' },
  { key: 'ledger',     icon: <BookOpen size={15} />,        label: 'Ledger' },
  { key: 'ideas',      icon: <Lightbulb size={15} />,       label: 'Ideas' },
  { key: 'drafts',     icon: <FileText size={15} />,        label: 'Drafts' },
  { key: 'review',     icon: <Eye size={15} />,             label: 'Review' },
  { key: 'bank',       icon: <Archive size={15} />,         label: 'Bank' },
  { key: 'published',  icon: <Send size={15} />,            label: 'Published' },
]

export function TabBar({
  active,
  onChange,
  counts,
}: {
  active: TabKey
  onChange: (k: TabKey) => void
  counts: Counts
}) {
  return (
    <nav className="dj-tabs">
      {TABS.map(t => {
        const n = counts[t.key]
        const isActive = active === t.key
        const isAlert = t.key === 'review' && typeof n === 'number' && n > 0
        return (
          <button
            key={t.key}
            type="button"
            className={`dj-tab ${isActive ? 'is-active' : ''}`}
            onClick={() => onChange(t.key)}
          >
            <span className="dj-tab-icon">{t.icon}</span>
            <span>{t.label}</span>
            {typeof n === 'number' && n > 0 && (
              <span className={`dj-tab-badge ${isAlert ? 'is-alert' : ''}`}>{n}</span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
