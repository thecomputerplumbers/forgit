-- Hosted billing is opt-in per organization. Existing self-hosted organizations
-- have no billing_account row and keep their current behavior.
CREATE TABLE billing_accounts (
  organization_id TEXT PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK(plan IN ('developer', 'business', 'enterprise')),
  status TEXT NOT NULL CHECK(status IN ('pending', 'active', 'past_due', 'cancelled')),
  stripe_customer_id TEXT UNIQUE,
  metronome_customer_id TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(status <> 'active' OR (stripe_customer_id IS NOT NULL AND metronome_customer_id IS NOT NULL))
);

-- The database records usage before any delivery to Metronome. One completed
-- job produces at most one fact, including on retries and reruns.
CREATE TABLE billing_usage_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  action_run_id TEXT NOT NULL REFERENCES action_runs(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  metric TEXT NOT NULL CHECK(metric = 'actions_job_duration_ms'),
  quantity INTEGER NOT NULL CHECK(quantity >= 0),
  occurred_at INTEGER NOT NULL,
  delivered_at INTEGER,
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  delivery_error TEXT,
  UNIQUE(action_run_id, job_id, metric)
);
CREATE INDEX billing_usage_pending ON billing_usage_events(delivered_at, occurred_at);
CREATE INDEX billing_usage_organization ON billing_usage_events(organization_id, occurred_at);

CREATE TRIGGER billing_action_job_usage AFTER UPDATE OF document ON action_runs BEGIN
  INSERT OR IGNORE INTO billing_usage_events
    (id, organization_id, repository_id, action_run_id, job_id, metric, quantity, occurred_at)
  SELECT new.id || ':' || json_extract(job.value, '$.id') || ':duration',
    repo.organization_id, new.repository_id, new.id,
    json_extract(job.value, '$.id'), 'actions_job_duration_ms',
    max(0, coalesce(json_extract(job.value, '$.completedAt'), json_extract(new.document, '$.completedAt')) - json_extract(job.value, '$.startedAt')),
    coalesce(json_extract(job.value, '$.completedAt'), json_extract(new.document, '$.completedAt'))
  FROM json_each(new.document, '$.jobs') AS job
  JOIN repositories AS repo ON repo.id = new.repository_id
  JOIN billing_accounts AS account ON account.organization_id = repo.organization_id
    AND account.status = 'active'
  WHERE json_extract(job.value, '$.status') = 'completed'
    AND json_type(job.value, '$.startedAt') = 'integer'
    AND (json_type(job.value, '$.completedAt') = 'integer'
      OR json_type(new.document, '$.completedAt') = 'integer');
END;
