-- Better Auth identity tables, plus forgit collaboration metadata.
-- Git objects are not stored here.

CREATE TABLE user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL,
  image TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  active_organization_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX session_user_idx ON session(user_id);

CREATE TABLE account (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  id_token TEXT,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX account_user_idx ON account(user_id);
CREATE UNIQUE INDEX account_provider_identity_idx ON account(provider_id, account_id);

CREATE TABLE verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX verification_identifier_idx ON verification(identifier);

CREATE TABLE rate_limit (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  last_request INTEGER NOT NULL
);

CREATE TABLE organization (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX organization_slug_idx ON organization(slug);

CREATE TABLE member (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL
);
CREATE INDEX member_organization_idx ON member(organization_id);
CREATE INDEX member_user_idx ON member(user_id);
CREATE UNIQUE INDEX member_org_user_idx ON member(organization_id, user_id);

CREATE TABLE invitation (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at INTEGER NOT NULL,
  inviter_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX invitation_organization_idx ON invitation(organization_id);
CREATE INDEX invitation_email_idx ON invitation(email);

CREATE TABLE user_profile (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  login TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  default_branch TEXT NOT NULL DEFAULT 'main',
  visibility TEXT NOT NULL DEFAULT 'private',
  archived INTEGER NOT NULL DEFAULT 0,
  backing_id TEXT NOT NULL UNIQUE,
  next_pr_number INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (organization_id, name)
);

CREATE TABLE repository_members (
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (repository_id, user_id)
);

CREATE TABLE repository_rules (
  repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
  required_approvals INTEGER NOT NULL DEFAULT 1,
  required_checks TEXT NOT NULL DEFAULT '[]',
  dismiss_stale_reviews INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE pull_requests (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL REFERENCES user(id),
  source_ref TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  state TEXT NOT NULL,
  merge_sha TEXT,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  merged_at INTEGER,
  UNIQUE (repository_id, number)
);
CREATE UNIQUE INDEX pull_requests_idempotency_idx ON pull_requests(repository_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE pull_request_reviews (
  id TEXT PRIMARY KEY,
  pull_request_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES user(id),
  head_sha TEXT NOT NULL,
  state TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE pull_request_comments (
  id TEXT PRIMARY KEY,
  pull_request_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES user(id),
  path TEXT NOT NULL,
  line INTEGER,
  body TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE checks (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (repository_id, name)
);

CREATE TABLE check_runs (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  status TEXT NOT NULL,
  conclusion TEXT,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (repository_id, name, head_sha)
);

CREATE TABLE check_annotations (
  id TEXT PRIMARY KEY,
  check_run_id TEXT NOT NULL REFERENCES check_runs(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  message TEXT NOT NULL,
  level TEXT NOT NULL
);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  scopes TEXT NOT NULL,
  repository_ids TEXT,
  kind TEXT NOT NULL,
  expires_at INTEGER,
  last_used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  client_secret_hash TEXT,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  repository_id TEXT,
  target TEXT NOT NULL,
  metadata TEXT NOT NULL,
  request_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_events_repository_idx ON audit_events(repository_id, created_at);

CREATE TABLE forge_rate (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
