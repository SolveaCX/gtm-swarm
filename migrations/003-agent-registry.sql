-- migrations/003-agent-registry.sql
-- Closes I2 (channel-pluggability) + enables I5 (auto-mix).
--
-- Today: 11 agents are hardcoded in 3 places:
--   1. ROSTER.md (table)
--   2. templates/contentos-agent/04-content-strategy.md (YAML schema lists 01-foundation..11-poster)
--   3. scripts/hydrate-agents.py (parser keyed on those names)
--
-- After this migration: agents are db rows. Adding a 12th agent = INSERT one row + redeploy.
-- The existing `agents` table (per-workspace instances) keeps its purpose;
-- a new `agent_definitions` table is the catalog of agent TYPES.
--
-- Status: DRAFT 2026-05-25 · safe to run (additive + seed of existing 11)

-- ----------------------------------------------------------------------
-- 1. agent_definitions — catalog of agent TYPES (universal, cross-product)
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,          -- e.g. '01-foundation', '12-producthunt', '13-mcp-registry'
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,             -- foundation | content | distribution | revenue-leads
  platforms TEXT[] NOT NULL,          -- ['reddit'] or ['youtube','tiktok','instagram']
  goal_template TEXT NOT NULL,        -- 1-sentence boilerplate, $product gets templated in
  kpi_schema JSONB NOT NULL,          -- {weekly_target: int, measure: text}
  reuse_pointer TEXT,                 -- where the Builder can find existing code, e.g. '~/MKT/TiktokAutoUploader'
  enabled BOOLEAN DEFAULT true,       -- soft-disable without delete
  -- Iron Triangle defaults at the type level. Per-instance overrides live in agents.
  default_builder_handle TEXT,
  default_reviewer_handle TEXT,
  ordering INT DEFAULT 999,           -- display order in roster
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_definitions_category ON agent_definitions(category) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_agent_definitions_ordering ON agent_definitions(ordering);

-- ----------------------------------------------------------------------
-- 2. Link existing per-workspace `agents` rows to a definition
-- ----------------------------------------------------------------------
ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_definition_id UUID REFERENCES agent_definitions(id);
CREATE INDEX IF NOT EXISTS idx_agents_definition ON agents(agent_definition_id);

-- ----------------------------------------------------------------------
-- 3. workspace_agents — per-product activation matrix
-- (Replaces the binary "11 hardcoded agents per product" assumption.)
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspace_agents (
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_definition_id UUID REFERENCES agent_definitions(id) ON DELETE CASCADE,
  activated BOOLEAN DEFAULT false,
  activation_reason TEXT,             -- from Step 4 LLM, "skip 11-poster: B2B SaaS, no WeChat audience"
  weekly_target INT,                  -- per-product KPI override
  topics JSONB DEFAULT '[]',          -- 3-5 specific topic strings from Step 4
  builder_handle TEXT,                -- per-product Iron Triangle override
  reviewer_handle TEXT,
  activated_at TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, agent_definition_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_agents_active
  ON workspace_agents(workspace_id) WHERE activated = true;

-- ----------------------------------------------------------------------
-- 4. Seed the existing 11 agents (from ROSTER.md, idempotent)
-- ----------------------------------------------------------------------
INSERT INTO agent_definitions
  (slug, display_name, category, platforms, goal_template, kpi_schema, reuse_pointer,
   default_builder_handle, default_reviewer_handle, ordering)
VALUES
  ('01-foundation', 'GTM Foundation', 'foundation', ARRAY['internal-dashboard'],
   'All agents connected. Execution monitoring, version mgmt, cost mgmt for $product.',
   '{"weekly_target": 0, "measure": "uptime %"}'::jsonb,
   '~/agent-teams', 'zhongshilong', 'boyuan', 1),

  ('02-kol-koc', 'KOL / KOC', 'distribution', ARRAY['youtube','tiktok','instagram'],
   'KOC outreach + auto-publishing for $product. Brand voice owned by Reviewer.',
   '{"weekly_target": 5, "measure": "videos published"}'::jsonb,
   '~/MKT/TiktokAutoUploader', 'zhangjilin', 'ivy', 2),

  ('03-blog', 'Blog', 'content', ARRAY['website'],
   'SEO blogs across $product lines. Monthly topic map.',
   '{"weekly_target": 2, "measure": "blogs published"}'::jsonb,
   '~/solvea-content-engine', 'zhangjilin', 'pengjing', 3),

  ('04-backlink', 'Backlink', 'content', ARRAY['external-sites'],
   'Quality backlinks + domain authority for $product.',
   '{"weekly_target": 5, "measure": "backlinks earned"}'::jsonb,
   NULL, NULL, 'pengjing', 4),

  ('05-video', 'Video', 'content', ARRAY['youtube','tiktok'],
   'Auto-generated videos for $product. Reviewer owns likes/views target.',
   '{"weekly_target": 3, "measure": "videos published"}'::jsonb,
   '~/MKT', 'zhangjilin', 'zhuangkexin', 5),

  ('06-reddit', 'Reddit', 'distribution', ARRAY['reddit'],
   'Auto-publish at scale for $product. Drive inbound traffic.',
   '{"weekly_target": 10, "measure": "posts published"}'::jsonb,
   NULL, 'wayne', 'ivy-chen', 6),

  ('07-social-media', 'Social Media', 'distribution', ARRAY['x','github','linkedin'],
   'Cross-platform native publishing for $product. Reviewer owns brand voice.',
   '{"weekly_target": 14, "measure": "posts/week"}'::jsonb,
   '~/solvea-content-engine', 'wayne', 'ivy-chen', 7),

  ('08-ads', 'Ads', 'revenue-leads', ARRAY['google-ads','ios-asa','android-ads'],
   'Paid acquisition for $product. Optimize CAC/conversion.',
   '{"weekly_target": 0, "measure": "CAC vs target"}'::jsonb,
   '~/google-ads', 'gaoboyuan', NULL, 8),

  ('09-edm', 'EDM', 'revenue-leads', ARRAY['email'],
   'Email pipeline + owned audience for $product.',
   '{"weekly_target": 1, "measure": "sends/week"}'::jsonb,
   '~/google-ads/dropin', NULL, NULL, 9),

  ('10-yelp', 'Yelp', 'revenue-leads', ARRAY['yelp'],
   'Auto-find leads from reviews/complaints for $product.',
   '{"weekly_target": 0, "measure": "leads outreached"}'::jsonb,
   NULL, NULL, NULL, 10),

  ('11-poster', 'Poster', 'distribution', ARRAY['wechat'],
   'WeChat 公众号 auto-publish for $product.',
   '{"weekly_target": 2, "measure": "articles published"}'::jsonb,
   NULL, NULL, NULL, 11),

  ('12-mcp-registry', 'MCP Registry', 'distribution', ARRAY['mcp.so','smithery','pulsemcp','awesome-mcp-servers'],
   'Publish $product as an agent-callable MCP tool. Maintain catalog presence + version bumps.',
   '{"weekly_target": 1, "measure": "catalog submissions or version bumps"}'::jsonb,
   '~/MKT/solvea-mcp', NULL, NULL, 12),

  ('13-customer-agent', 'Customer Agent', 'revenue-leads', ARRAY['website-chat','in-app-chat','email','support-desk'],
   'Convert pre-sales users for $product and resolve post-sales customer requests with measurable retention impact.',
   '{"weekly_target": 20, "measure": "qualified conversations or resolved support cases"}'::jsonb,
   'Solvea customer service agent', NULL, 'boyuan', 13)

ON CONFLICT (slug) DO NOTHING;

-- ----------------------------------------------------------------------
-- 5. Convenience view: per-workspace deployable count (Iron Triangle gate)
-- ----------------------------------------------------------------------
CREATE OR REPLACE VIEW workspace_agent_deployability AS
SELECT
  w.slug AS workspace_slug,
  ad.slug AS agent_slug,
  ad.display_name,
  wa.activated,
  COALESCE(wa.builder_handle, ad.default_builder_handle)   AS builder,
  COALESCE(wa.reviewer_handle, ad.default_reviewer_handle) AS reviewer,
  (
    COALESCE(wa.builder_handle, ad.default_builder_handle) IS NOT NULL
    AND
    COALESCE(wa.reviewer_handle, ad.default_reviewer_handle) IS NOT NULL
  ) AS triangle_complete
FROM workspaces w
CROSS JOIN agent_definitions ad
LEFT JOIN workspace_agents wa
       ON wa.workspace_id = w.id AND wa.agent_definition_id = ad.id
WHERE ad.enabled = true;

-- After this migration, Step 4 prompt should read agent_definitions WHERE enabled=true
-- and write activation decisions back to workspace_agents.  No more hardcoded `01-foundation..11-poster`.
