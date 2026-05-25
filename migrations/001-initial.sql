-- migrations/001-initial.sql

CREATE TABLE IF NOT EXISTS channel_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT UNIQUE NOT NULL,
  review_checklist JSONB DEFAULT '[]',
  content_template JSONB DEFAULT '{}',
  dashboard_widgets JSONB DEFAULT '[]',
  kpi_defaults JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL DEFAULT 'onboarding',
  urls JSONB DEFAULT '{}',
  project_config JSONB DEFAULT '{}',
  engine_overrides JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategy_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  usage JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contentos_states (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  current_step INT DEFAULT 0,
  steps JSONB DEFAULT '{}',
  last_updated TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  channels JSONB DEFAULT '[]',
  max_workload INT DEFAULT 3,
  active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  channel_profile_id UUID REFERENCES channel_profiles(id),
  status TEXT DEFAULT 'active',
  config JSONB DEFAULT '{}',
  metrics JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_assignments (
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  person_id UUID REFERENCES people(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  PRIMARY KEY (agent_id, role)
);

CREATE TABLE IF NOT EXISTS content_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id),
  state TEXT NOT NULL DEFAULT 'new-idea',
  frontmatter JSONB DEFAULT '{}',
  body TEXT DEFAULT '',
  mtime TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  content TEXT DEFAULT '',
  UNIQUE (workspace_id, file_path)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  actor TEXT,
  action TEXT,
  detail JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_items_workspace_state ON content_items(workspace_id, state);
CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_engines_lookup ON engines(workspace_id, file_path);
CREATE INDEX IF NOT EXISTS idx_audit_log_workspace ON audit_log(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_docs_workspace ON strategy_docs(workspace_id, step_key);

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS cia_result JSONB;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS multica_workspace_slug TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS swarm_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_swarm_token ON workspaces(swarm_token) WHERE swarm_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS swarm_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  node_id TEXT,
  platform TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  url TEXT,
  title TEXT,
  body TEXT,
  source_time TIMESTAMPTZ,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, platform, artifact_type, external_id)
);

CREATE TABLE IF NOT EXISTS swarm_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  artifact_id UUID REFERENCES swarm_artifacts(id) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  node_id TEXT,
  observed_at TIMESTAMPTZ NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}',
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, observed_at)
);

CREATE TABLE IF NOT EXISTS swarm_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  priority INT NOT NULL DEFAULT 0,
  lease_node_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  target JSONB NOT NULL DEFAULT '{}',
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS swarm_daily_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  report_type TEXT NOT NULL DEFAULT 'generic',
  enabled BOOLEAN NOT NULL DEFAULT true,
  multica_agent_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, agent_key, platform)
);

CREATE TABLE IF NOT EXISTS swarm_daily_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  target_id UUID REFERENCES swarm_daily_targets(id) ON DELETE CASCADE,
  job_id UUID REFERENCES swarm_jobs(id) ON DELETE SET NULL,
  day DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  missing_reason TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (target_id, day)
);

CREATE INDEX IF NOT EXISTS idx_swarm_artifacts_report ON swarm_artifacts(workspace_id, platform, artifact_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swarm_artifacts_identity ON swarm_artifacts(workspace_id, platform, artifact_type, external_id);
CREATE INDEX IF NOT EXISTS idx_swarm_observations_artifact_time ON swarm_observations(artifact_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_swarm_observations_workspace_time ON swarm_observations(workspace_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_swarm_jobs_lease ON swarm_jobs(workspace_id, agent_key, status, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_swarm_daily_targets_workspace ON swarm_daily_targets(workspace_id, enabled, platform);
CREATE INDEX IF NOT EXISTS idx_swarm_daily_runs_status ON swarm_daily_runs(status, day DESC);
