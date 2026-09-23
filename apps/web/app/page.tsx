import { headers } from "next/headers";

import { CodeBlock, ListFilter } from "@/components/client";
import { Icon } from "@/components/icons";
import { Shell } from "@/components/shell";
import { Badge, Box, EmptyState, PageHeader, TimeAgo } from "@/components/ui";
import { plural } from "@/lib/format";
import { requireOrganization } from "@/lib/session";

export default async function HomePage() {
  const { services, actor, user, organization } = await requireOrganization();
  const repos = (await services.listVisibleRepositories(actor))
    .filter((repo) => repo.owner === organization.slug)
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const host = (await headers()).get("host") ?? "forgit";
  return (
    <Shell organization={organization} user={user}>
      <div className="container page">
        <PageHeader
          actions={
            <a className="btn btn-primary" href="/new">
              <Icon name="plus" /> New repository
            </a>
          }
          description={
            repos.length
              ? `${plural(repos.length, "repository", "repositories")} you can access.`
              : undefined
          }
          title="Repositories"
        />
        <div className="layout-sidebar">
          <div className="stack">
            {repos.length > 0 ? (
              <ListFilter placeholder="Find a repository…" target="repo-list" />
            ) : null}
            <Box flush>
              {repos.length === 0 ? (
                <EmptyState
                  action={
                    <a className="btn btn-primary" href="/new">
                      <Icon name="plus" /> Create repository
                    </a>
                  }
                  icon="book"
                  title="No repositories yet"
                >
                  Create a repository, then push to it over HTTPS with a personal access token.
                </EmptyState>
              ) : (
                <ul className="list" id="repo-list">
                  {repos.map((repo) => (
                    <li data-filter={`${repo.name} ${repo.description}`} key={repo.id}>
                      <Icon className="icon list-icon muted" name="book" />
                      <div className="list-main">
                        <div className="list-title">
                          <a className="repo-list-name" href={`/${repo.owner}/${repo.name}`}>
                            {repo.name}
                          </a>
                          <Badge icon={repo.visibility === "public" ? "globe" : "lock"}>
                            {repo.visibility === "public" ? "Public" : "Private"}
                          </Badge>
                          {repo.archived ? <Badge tone="warning">Archived</Badge> : null}
                        </div>
                        {repo.description ? (
                          <p className="list-meta" style={{ color: "var(--text-2)" }}>
                            {repo.description}
                          </p>
                        ) : null}
                        <div className="list-meta">
                          <Icon name="branch" size={13} /> {repo.defaultBranch}
                          <span className="dot" />
                          Updated <TimeAgo value={repo.updatedAt} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Box>
          </div>
          <Box title="Connect your tools">
            <ol className="setup-steps">
              <li>
                <strong>Create an access token</strong>
                <span>
                  Tokens authenticate Git, <code>gh</code>, and the API.{" "}
                  <a href="/settings/tokens">Create a token →</a>
                </span>
              </li>
              <li>
                <strong>Use it as your Git password</strong>
                <CodeBlock code={`git clone https://${host}/${organization.slug}/<repo>.git`} />
              </li>
              <li>
                <strong>
                  Point <code>gh</code> at forgit
                </strong>
                <CodeBlock
                  code={`export GH_HOST=${host}\nexport GH_ENTERPRISE_TOKEN=<token>\ngh config set git_protocol https --host ${host}`}
                />
              </li>
            </ol>
          </Box>
        </div>
      </div>
    </Shell>
  );
}
