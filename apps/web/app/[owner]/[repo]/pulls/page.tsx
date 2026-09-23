import { ListFilter } from "@/components/client";
import { Icon } from "@/components/icons";
import { PULL_ICON, RepoHeader } from "@/components/repo";
import { Shell } from "@/components/shell";
import { Box, EmptyState, TimeAgo } from "@/components/ui";
import { loadLogins, loadRepoPage } from "@/lib/repo-page";

const FILTERS = ["open", "merged", "closed", "all"] as const;
type Filter = (typeof FILTERS)[number];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  return { title: `Pull requests · ${owner}/${repo}` };
}

export default async function PullsPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ state?: string }>;
}) {
  const { owner, repo: name } = await params;
  const requested = (await searchParams).state;
  const filter: Filter = FILTERS.includes(requested as Filter) ? (requested as Filter) : "open";
  const { services, user, organization, repo } = await loadRepoPage(owner, name);
  const all = await services.store.listPullRequests(repo.id, "all");
  const counts = {
    open: all.filter((pull) => pull.state === "open").length,
    merged: all.filter((pull) => pull.state === "merged").length,
    closed: all.filter((pull) => pull.state === "closed").length,
    all: all.length,
  };
  const pulls = all
    .filter((pull) => filter === "all" || pull.state === filter)
    .sort((left, right) => right.number - left.number);
  const logins = await loadLogins(
    services.store,
    pulls.map((pull) => pull.authorId),
  );
  const base = `/${owner}/${name}/pulls`;
  return (
    <Shell organization={organization} user={user}>
      <RepoHeader current="Pull requests" openPulls={counts.open} owner={owner} repo={repo} />
      <div className="container page">
        <div className="toolbar">
          <nav aria-label="Filter pull requests" className="segmented">
            {FILTERS.map((each) => (
              <a
                aria-current={each === filter ? "page" : undefined}
                href={each === "open" ? base : `${base}?state=${each}`}
                key={each}
              >
                {each[0]?.toUpperCase()}
                {each.slice(1)} <span className="counter">{counts[each]}</span>
              </a>
            ))}
          </nav>
          {pulls.length > 0 ? (
            <div style={{ flex: 1, minWidth: 200 }}>
              <ListFilter
                placeholder="Filter by title, number, branch, or author…"
                target="pull-list"
              />
            </div>
          ) : (
            <span className="spacer" />
          )}
          {repo.archived ? null : (
            <a className="btn btn-primary" href={`${base}/new`}>
              <Icon name="plus" /> New pull request
            </a>
          )}
        </div>
        <Box flush>
          {pulls.length === 0 ? (
            <EmptyState
              action={
                repo.archived || filter !== "open" ? undefined : (
                  <a className="btn" href={`${base}/new`}>
                    <Icon name="plus" /> New pull request
                  </a>
                )
              }
              icon="pull"
              title={filter === "all" ? "No pull requests yet" : `No ${filter} pull requests`}
            >
              Pull requests propose changes from a branch and merge them into{" "}
              <code>{repo.defaultBranch}</code> once they're approved. You can also open them with{" "}
              <code>gh pr create</code>.
            </EmptyState>
          ) : (
            <ul className="list" id="pull-list">
              {pulls.map((pull) => (
                <li
                  className="list-link"
                  data-filter={`#${pull.number} ${pull.title} ${pull.sourceRef} ${logins.get(pull.authorId) ?? ""}`}
                  key={pull.id}
                  style={{ alignItems: "flex-start" }}
                >
                  <Icon
                    className={`icon list-icon pr-icon-${pull.state}`}
                    name={PULL_ICON[pull.state]}
                  />
                  <div className="list-main">
                    <a className="list-title" href={`/${owner}/${name}/pull/${pull.number}`}>
                      {pull.title}
                    </a>
                    <div className="list-meta">
                      #{pull.number}
                      <span className="dot" />
                      {pull.state === "merged" && pull.mergedAt ? (
                        <>
                          merged <TimeAgo value={pull.mergedAt} />
                        </>
                      ) : pull.state === "closed" && pull.closedAt ? (
                        <>
                          closed <TimeAgo value={pull.closedAt} />
                        </>
                      ) : (
                        <>
                          opened <TimeAgo value={pull.createdAt} />
                        </>
                      )}{" "}
                      by {logins.get(pull.authorId)}
                      <span className="dot" />
                      <span className="branch-chip">{pull.sourceRef}</span>
                      <Icon name="chevronRight" size={12} />
                      <span className="branch-chip">{pull.targetRef}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Box>
      </div>
    </Shell>
  );
}
