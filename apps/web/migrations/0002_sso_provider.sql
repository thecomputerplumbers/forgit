CREATE TABLE sso_provider (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  domain TEXT NOT NULL,
  domain_verified INTEGER,
  oidc_config TEXT,
  saml_config TEXT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL UNIQUE,
  organization_id TEXT REFERENCES organization(id) ON DELETE CASCADE
);
CREATE INDEX sso_provider_organization_idx ON sso_provider(organization_id);
