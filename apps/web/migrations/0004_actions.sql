ALTER TABLE check_runs ADD COLUMN producer TEXT NOT NULL DEFAULT 'external';
ALTER TABLE check_runs ADD COLUMN action_run_id TEXT;
ALTER TABLE check_runs ADD COLUMN action_sequence INTEGER NOT NULL DEFAULT 0;

CREATE TABLE action_settings (
  repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
  document TEXT NOT NULL CHECK(json_valid(document))
);
CREATE TABLE action_events (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  document TEXT NOT NULL CHECK(json_valid(document)),
  created_at INTEGER NOT NULL,
  processed_at INTEGER,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX action_events_pending ON action_events(processed_at, created_at);
CREATE TABLE action_runs (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  workflow_path TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  check_name TEXT NOT NULL,
  document TEXT NOT NULL CHECK(json_valid(document)),
  version INTEGER NOT NULL DEFAULT 0,
  dispatched_at INTEGER,
  UNIQUE(repository_id, event_key, workflow_path)
);
CREATE INDEX action_runs_repo ON action_runs(repository_id, sequence DESC);
CREATE INDEX action_runs_head ON action_runs(repository_id, head_sha);

-- Project only the newest run/attempt for a check. Delayed updates cannot
-- overwrite a newer queued, failed, or cancelled attempt.
CREATE TRIGGER action_run_insert AFTER INSERT ON action_runs BEGIN
  INSERT INTO check_runs(id,repository_id,name,head_sha,status,conclusion,title,summary,started_at,completed_at,producer,action_run_id,action_sequence)
  VALUES(new.id,new.repository_id,new.check_name,new.head_sha,
    CASE json_extract(new.document,'$.status') WHEN 'completed' THEN 'completed' WHEN 'queued' THEN 'queued' ELSE 'in_progress' END,
    CASE json_extract(new.document,'$.conclusion') WHEN 'success' THEN 'success' WHEN NULL THEN NULL ELSE CASE WHEN json_extract(new.document,'$.status')='completed' THEN 'failure' ELSE NULL END END,
    json_extract(new.document,'$.workflow.name'),coalesce(json_extract(new.document,'$.error'),''),json_extract(new.document,'$.createdAt'),json_extract(new.document,'$.completedAt'),'actions',new.id,new.sequence)
  ON CONFLICT(repository_id,name,head_sha) DO UPDATE SET
    status=excluded.status,conclusion=excluded.conclusion,title=excluded.title,summary=excluded.summary,
    started_at=excluded.started_at,completed_at=excluded.completed_at,producer='actions',action_run_id=excluded.action_run_id,action_sequence=excluded.action_sequence
  WHERE excluded.action_sequence >= check_runs.action_sequence;
END;
CREATE TRIGGER action_run_update AFTER UPDATE OF document ON action_runs BEGIN
  UPDATE check_runs SET
    status=CASE json_extract(new.document,'$.status') WHEN 'completed' THEN 'completed' WHEN 'queued' THEN 'queued' ELSE 'in_progress' END,
    conclusion=CASE WHEN json_extract(new.document,'$.status')!='completed' THEN NULL WHEN json_extract(new.document,'$.conclusion')='success' THEN 'success' ELSE 'failure' END,
    summary=coalesce(json_extract(new.document,'$.error'),''),completed_at=json_extract(new.document,'$.completedAt')
  WHERE repository_id=new.repository_id AND name=new.check_name AND head_sha=new.head_sha AND producer='actions' AND action_sequence=new.sequence;
END;
CREATE TABLE action_environments (
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  document TEXT NOT NULL CHECK(json_valid(document)),
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(repository_id,name)
);
CREATE TABLE action_secrets (
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  environment TEXT NOT NULL,
  name TEXT NOT NULL,
  encrypted TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(repository_id,environment,name),
  FOREIGN KEY(repository_id,environment) REFERENCES action_environments(repository_id,name) ON DELETE CASCADE
);
CREATE TABLE action_leases (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES action_runs(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  environment TEXT,
  expires_at INTEGER NOT NULL,
  UNIQUE(repository_id,environment)
);
CREATE TABLE action_deployments (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES action_runs(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(run_id,job_id)
);
