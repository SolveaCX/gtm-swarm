// server/agent-registry.js
//
// Single source of truth for the agent CATALOG (types of agents the platform supports).
// Before this file: 11 agents hardcoded across ROSTER.md / templates/04-content-strategy.md /
// scripts/hydrate-agents.py / dashboard UI.
//
// After this file: add an agent by appending one entry below. Step 4 prompt receives this
// registry as context; hydrator picks up new agent IDs automatically.
//
// Eventual destination: agent_definitions DB table (migration 003-agent-registry.sql).
// This file is the transitional implementation that ships universal-channel capability
// without requiring a DB migration on day one.
//
// Aligned with Principle 04: "The swarm adapts to whatever you need to sell."

/**
 * @typedef {Object} AgentDefinition
 * @property {string} slug                  - e.g. "01-foundation", "12-producthunt"
 * @property {string} display_name
 * @property {"foundation"|"content"|"distribution"|"revenue-leads"} category
 * @property {string[]} platforms           - ["reddit"] or ["youtube","tiktok","instagram"]
 * @property {string} goal_template         - 1-sentence boilerplate, $product gets templated in
 * @property {{weekly_target:number, measure:string}} kpi_schema
 * @property {string|null} reuse_pointer    - existing code to start from
 * @property {string|null} default_builder_handle
 * @property {string|null} default_reviewer_handle
 * @property {number} ordering
 * @property {boolean} enabled
 */

/** @type {AgentDefinition[]} */
const AGENT_DEFINITIONS = [
  {
    slug: '01-foundation',
    display_name: 'GTM Foundation',
    category: 'foundation',
    platforms: ['internal-dashboard'],
    goal_template: 'All agents connected. Execution monitoring, version mgmt, cost mgmt for $product.',
    kpi_schema: { weekly_target: 0, measure: 'uptime %' },
    reuse_pointer: '~/agent-teams',
    default_builder_handle: 'zhongshilong',
    default_reviewer_handle: 'boyuan',
    ordering: 1,
    enabled: true,
  },
  {
    slug: '02-kol-koc',
    display_name: 'KOL / KOC',
    category: 'distribution',
    platforms: ['youtube', 'tiktok', 'instagram'],
    goal_template: 'KOC outreach + auto-publishing for $product. Brand voice owned by Reviewer.',
    kpi_schema: { weekly_target: 5, measure: 'videos published' },
    reuse_pointer: '~/MKT/TiktokAutoUploader',
    default_builder_handle: 'zhangjilin',
    default_reviewer_handle: 'ivy',
    ordering: 2,
    enabled: true,
  },
  {
    slug: '03-blog',
    display_name: 'Blog',
    category: 'content',
    platforms: ['website'],
    goal_template: 'SEO blogs across $product lines. Monthly topic map.',
    kpi_schema: { weekly_target: 2, measure: 'blogs published' },
    reuse_pointer: '~/solvea-content-engine',
    default_builder_handle: 'zhangjilin',
    default_reviewer_handle: 'pengjing',
    ordering: 3,
    enabled: true,
  },
  {
    slug: '04-backlink',
    display_name: 'Backlink',
    category: 'content',
    platforms: ['external-sites'],
    goal_template: 'Quality backlinks + domain authority for $product.',
    kpi_schema: { weekly_target: 5, measure: 'backlinks earned' },
    reuse_pointer: null,
    default_builder_handle: null,
    default_reviewer_handle: 'pengjing',
    ordering: 4,
    enabled: true,
  },
  {
    slug: '05-video',
    display_name: 'Video',
    category: 'content',
    platforms: ['youtube', 'tiktok'],
    goal_template: 'Auto-generated videos for $product. Reviewer owns likes/views target.',
    kpi_schema: { weekly_target: 3, measure: 'videos published' },
    reuse_pointer: '~/MKT',
    default_builder_handle: 'zhangjilin',
    default_reviewer_handle: 'zhuangkexin',
    ordering: 5,
    enabled: true,
  },
  {
    slug: '06-reddit',
    display_name: 'Reddit',
    category: 'distribution',
    platforms: ['reddit'],
    goal_template: 'Auto-publish at scale for $product. Drive inbound traffic.',
    kpi_schema: { weekly_target: 10, measure: 'posts published' },
    reuse_pointer: null,
    default_builder_handle: 'wayne',
    default_reviewer_handle: 'ivy-chen',
    ordering: 6,
    enabled: true,
  },
  {
    slug: '07-social-media',
    display_name: 'Social Media',
    category: 'distribution',
    platforms: ['x', 'github', 'linkedin'],
    goal_template: 'Cross-platform native publishing for $product. Reviewer owns brand voice.',
    kpi_schema: { weekly_target: 14, measure: 'posts/week' },
    reuse_pointer: '~/solvea-content-engine',
    default_builder_handle: 'wayne',
    default_reviewer_handle: 'ivy-chen',
    ordering: 7,
    enabled: true,
  },
  {
    slug: '08-ads',
    display_name: 'Ads',
    category: 'revenue-leads',
    platforms: ['google-ads', 'ios-asa', 'android-ads'],
    goal_template: 'Paid acquisition for $product. Optimize CAC/conversion.',
    kpi_schema: { weekly_target: 0, measure: 'CAC vs target' },
    reuse_pointer: '~/google-ads',
    default_builder_handle: 'gaoboyuan',
    default_reviewer_handle: null,
    ordering: 8,
    enabled: true,
  },
  {
    slug: '09-edm',
    display_name: 'EDM',
    category: 'revenue-leads',
    platforms: ['email'],
    goal_template: 'Email pipeline + owned audience for $product.',
    kpi_schema: { weekly_target: 1, measure: 'sends/week' },
    reuse_pointer: '~/google-ads/dropin',
    default_builder_handle: null,
    default_reviewer_handle: null,
    ordering: 9,
    enabled: true,
  },
  {
    slug: '10-yelp',
    display_name: 'Yelp',
    category: 'revenue-leads',
    platforms: ['yelp'],
    goal_template: 'Auto-find leads from reviews/complaints for $product.',
    kpi_schema: { weekly_target: 0, measure: 'leads outreached' },
    reuse_pointer: null,
    default_builder_handle: null,
    default_reviewer_handle: null,
    ordering: 10,
    enabled: true,
  },
  {
    slug: '11-poster',
    display_name: 'Poster (WeChat)',
    category: 'distribution',
    platforms: ['wechat'],
    goal_template: 'WeChat 公众号 auto-publish for $product.',
    kpi_schema: { weekly_target: 2, measure: 'articles published' },
    reuse_pointer: null,
    default_builder_handle: null,
    default_reviewer_handle: null,
    ordering: 11,
    enabled: true,
  },
  // -------------------------------------------------------------------
  // N+1 proof: agent-native channel (MCP registries) — added 2026-05-25
  // Honors Principle 06 "Agents Are the New Distribution Channel."
  // Zero changes to ROSTER.md / Step 4 prompt / hydrate-agents.py required.
  // -------------------------------------------------------------------
  {
    slug: '12-mcp-registry',
    display_name: 'MCP Registry',
    category: 'distribution',
    platforms: ['mcp.so', 'smithery', 'pulsemcp', 'awesome-mcp-servers'],
    goal_template: 'Publish $product as an agent-callable MCP tool. Maintain catalog presence + version bumps.',
    kpi_schema: { weekly_target: 1, measure: 'catalog submissions or version bumps' },
    reuse_pointer: '~/MKT/solvea-mcp',
    default_builder_handle: null,
    default_reviewer_handle: null,
    ordering: 12,
    enabled: true,
  },
  {
    slug: '13-customer-agent',
    display_name: 'Customer Agent',
    category: 'revenue-leads',
    platforms: ['website-chat', 'in-app-chat', 'email', 'support-desk'],
    goal_template: 'Convert pre-sales users for $product and resolve post-sales customer requests with measurable retention impact.',
    kpi_schema: { weekly_target: 20, measure: 'qualified conversations or resolved support cases' },
    reuse_pointer: 'Solvea customer service agent',
    default_builder_handle: null,
    default_reviewer_handle: 'boyuan',
    ordering: 13,
    enabled: true,
  },
]

export function listAgentDefinitions({ enabledOnly = true } = {}) {
  const rows = enabledOnly ? AGENT_DEFINITIONS.filter(a => a.enabled) : AGENT_DEFINITIONS
  return [...rows].sort((a, b) => a.ordering - b.ordering)
}

export function getAgentDefinition(slug) {
  return AGENT_DEFINITIONS.find(a => a.slug === slug) || null
}

export function agentRegistryForPrompt() {
  return listAgentDefinitions().map(a => ({
    agent_slug: a.slug,
    display_name: a.display_name,
    category: a.category,
    platforms: a.platforms,
    goal_template: a.goal_template,
    kpi_schema: a.kpi_schema,
    triangle_complete: a.default_builder_handle != null && a.default_reviewer_handle != null,
  }))
}
