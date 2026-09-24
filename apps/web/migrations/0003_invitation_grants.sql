CREATE TABLE invitation_repo_grants (
  invitation_id TEXT NOT NULL REFERENCES invitation(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('read', 'write')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (invitation_id, repository_id)
);
CREATE INDEX invitation_repo_grants_repository_idx ON invitation_repo_grants(repository_id);
