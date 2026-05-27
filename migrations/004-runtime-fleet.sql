CREATE TABLE IF NOT EXISTS runtime (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspace(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  machine_key TEXT NOT NULL,
  profile TEXT NOT NULL,
  capabilities JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'offline',
  health JSONB DEFAULT '{}',
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id, machine_key, profile)
);

ALTER TABLE agent ADD COLUMN IF NOT EXISTS runtime_id UUID REFERENCES runtime(id);
ALTER TABLE agent ADD COLUMN IF NOT EXISTS runtime_mode TEXT DEFAULT 'cloud';
ALTER TABLE agent ADD COLUMN IF NOT EXISTS runtime_config JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_runtime_workspace_profile ON runtime(workspace_id, profile);
CREATE INDEX IF NOT EXISTS idx_runtime_last_seen ON runtime(last_seen_at);
