import { headers } from "next/headers";

import { revokeTokenAction } from "@/app/actions";
import { Icon } from "@/components/icons";
import { Shell } from "@/components/shell";
import { TokenForm } from "@/components/token-form";
import { Badge, Box, EmptyState, PageHeader, TimeAgo } from "@/components/ui";
import { requireForge } from "@/lib/session";

export const metadata = { title: "Access tokens" };

export default async function TokensPage() {
  const { services, actor, user, organization } = await requireForge();
  const [tokens, repos] = await Promise.all([
    services.store.listTokens(user.id),
    services.listVisibleRepositories(actor),
  ]);
  const host = (await headers()).get("host") ?? "forgit";
  const now = services.store.now();
  const sorted = [...tokens].sort(
    (left, right) =>
      Number(Boolean(left.revokedAt)) - Number(Boolean(right.revokedAt)) ||
      right.createdAt - left.createdAt,
  );
  return (
    <Shell organization={organization} user={user}>
      <div className="container container-narrow page">
        <PageHeader
          description={
            <>
              Tokens authenticate Git over HTTPS, the <code>gh</code> CLI, the REST API, and MCP.
              Use one as your Git password or as <code>GH_ENTERPRISE_TOKEN</code>.
            </>
          }
          title="Access tokens"
        />
        <div className="stack" style={{ gap: 24 }}>
          <Box flush title="Your tokens">
            {sorted.length === 0 ? (
              <EmptyState icon="key" title="No tokens yet">
                Generate one below to push code or use <code>gh</code>.
              </EmptyState>
            ) : (
              <ul className="list">
                {sorted.map((token) => {
                  const expired = token.expiresAt !== null && token.expiresAt <= now;
                  return (
                    <li
                      key={token.id}
                      style={token.revokedAt || expired ? { opacity: 0.6 } : undefined}
                    >
                      <Icon
                        className="icon list-icon muted"
                        name={token.kind === "machine" ? "terminal" : "key"}
                      />
                      <div className="list-main">
                        <div className="list-title">
                          {token.name}
                          <code className="sha-chip">{token.prefix}…</code>
                          {token.revokedAt ? (
                            <Badge tone="danger">Revoked</Badge>
                          ) : expired ? (
                            <Badge tone="warning">Expired</Badge>
                          ) : token.kind === "machine" ? (
                            <Badge tone="accent">Machine</Badge>
                          ) : null}
                        </div>
                        <div className="list-meta">{token.scopes.join(" · ")}</div>
                        <div className="list-meta">
                          Created <TimeAgo value={token.createdAt} />
                          <span className="dot" />
                          {token.lastUsedAt ? (
                            <>
                              Last used <TimeAgo value={token.lastUsedAt} />
                            </>
                          ) : (
                            "Never used"
                          )}
                          <span className="dot" />
                          {token.expiresAt ? (
                            <>
                              {expired ? "Expired" : "Expires"} <TimeAgo value={token.expiresAt} />
                            </>
                          ) : (
                            "No expiration"
                          )}
                          {token.repositoryIds ? (
                            <>
                              <span className="dot" />
                              {token.repositoryIds.length} selected{" "}
                              {token.repositoryIds.length === 1 ? "repository" : "repositories"}
                            </>
                          ) : null}
                        </div>
                      </div>
                      {token.revokedAt ? null : (
                        <form action={revokeTokenAction}>
                          <input name="id" type="hidden" value={token.id} />
                          <button className="btn btn-sm btn-danger" type="submit">
                            Revoke
                          </button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Box>
          <Box title="Generate a new token">
            <TokenForm
              host={host}
              repositories={repos.map((repo) => `${repo.owner}/${repo.name}`)}
            />
          </Box>
        </div>
      </div>
    </Shell>
  );
}
