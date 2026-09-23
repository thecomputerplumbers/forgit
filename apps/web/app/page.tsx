import type { AuditEvent, PullRequest } from "@forgit/domain";

import { CodeBlock, CopyButton, ListFilter } from "@/components/client";
import { Icon } from "@/components/icons";
import { PULL_ICON } from "@/components/repo";
import { Shell } from "@/components/shell";
import { Avatar, Badge, EmptyState, TimeAgo } from "@/components/ui";
import { describeActivity } from "@/lib/activity";
import { animalFor } from "@/lib/themes";
import { plural } from "@/lib/format";
import { loadLogins } from "@/lib/repo-page";
import { requireOrganization } from "@/lib/session";

/** Beyond this many repositories the feed only reads the most recently updated. */
const ACTIVITY_REPOS = 20;

export default async function HomePage() {
  const { services, actor, user, organization } = await requireOrganization();
  const repos = (await services.listVisibleRepositories(actor))
    .filter((repo) => repo.owner === organization.slug)
    .sort(
      (left, right) =>
        Number(left.archived) - Number(right.archived) || right.updatedAt - left.updatedAt,
    );
  const recent = repos.slice(0, ACTIVITY_REPOS);
  const [pullLists, auditLists, members, tokens] = await Promise.all([
    Promise.all(repos.map((repo) => services.store.listPullRequests(repo.id, "all"))),
    Promise.all(recent.map((repo) => services.store.listAudit(repo.id, 8))),
    services.store.listOrgMembers(organization.id),
    services.store.listTokens(user.id),
  ]);

  const pulls = repos.flatMap((repo, index) =>
    (pullLists[index] ?? []).map((pull) => ({ ...pull, repo: repo.name })),
  );
  const open = pulls.filter((pull) => pull.state === "open");
  const openByRepo = new Map<string, number>();
  for (const pull of open) openByRepo.set(pull.repo, (openByRepo.get(pull.repo) ?? 0) + 1);

  // Someone else's open pull request is waiting on you until you review its current head.
  const others = open.filter((pull) => pull.authorId !== user.id).slice(0, 30);
  const reviewLists = await Promise.all(others.map((pull) => services.store.listReviews(pull.id)));
  const toReview = others.filter(
    (pull, index) =>
      !(reviewLists[index] ?? []).some(
        (review) => review.authorId === user.id && review.headSha === pull.headSha,
      ),
  );
  const mine = open.filter((pull) => pull.authorId === user.id);

  const titles = new Map(pulls.map((pull) => [`${pull.repo}#${pull.number}`, pull]));
  const activity = recent
    .flatMap((repo, index) =>
      (auditLists[index] ?? []).map((event) => ({ event, repo: repo.name })),
    )
    .map((entry) => ({ ...entry, line: describeActivity(entry.event) }))
    .filter(
      (entry): entry is { event: AuditEvent; repo: string; line: NonNullable<typeof entry.line> } =>
        Boolean(entry.line),
    )
    .sort((left, right) => right.event.createdAt - left.event.createdAt)
    .slice(0, 12);
  const logins = await loadLogins(services.store, [
    ...activity.flatMap((entry) => (entry.event.actorId ? [entry.event.actorId] : [])),
    ...toReview.map((pull) => pull.authorId),
  ]);

  const origin = new URL(services.cloneUrl(organization.slug, "x")).origin;
  const host = new URL(origin).host;
  const base = `${origin}/${organization.slug}`;
  const setup = [
    { done: repos.length > 0, label: "Create a repository", href: "/new" },
    {
      done: tokens.some((token) => !token.revokedAt),
      label: "Create an access token for Git and gh",
      href: "/settings/tokens",
    },
    {
      done: pulls.length > 0,
      label: "Open a pull request",
      href: repos[0] ? `/${repos[0].owner}/${repos[0].name}/pulls/new` : "/new",
    },
    { done: members.length > 1, label: "Invite a teammate", href: "/settings/members" },
  ];
  const setupLeft = setup.filter((step) => !step.done).length;

  return (
    <Shell organization={organization} user={user}>
      <div className="container page home">
        <section aria-label={organization.name} className="plate">
          <span aria-hidden="true" className="rivet rivet-tl" />
          <span aria-hidden="true" className="rivet rivet-tr" />
          <span aria-hidden="true" className="rivet rivet-bl" />
          <span aria-hidden="true" className="rivet rivet-br" />
          <div className="plate-body">
            <h1 className="plate-name">{organization.name}</h1>
            <div className="plate-host">
              <code>{base}/</code>
              <CopyButton label="Copy repository URL prefix" value={`${base}/`} />
            </div>
          </div>
          <a className="btn plate-action" href="/new">
            <Icon name="plus" /> New repository
          </a>
        </section>

        <p className="home-summary">
          {summary(repos.length, toReview.length, mine.length, members.length)}
        </p>

        <div className="layout-sidebar">
          <section aria-labelledby="repos-heading" className="stack">
            <div className="home-section-head">
              <h2 id="repos-heading">Repositories</h2>
              {repos.length > 3 ? (
                <div className="home-filter">
                  <ListFilter placeholder="Find a repository" target="manifold" />
                </div>
              ) : null}
            </div>
            {repos.length === 0 ? (
              <div className="box">
                <EmptyState
                  action={
                    <a className="btn btn-primary" href="/new">
                      <Icon name="plus" /> Create a repository
                    </a>
                  }
                  icon="book"
                  title="No repositories yet"
                >
                  Create one here, or push an existing project with <code>gh repo create</code>.
                </EmptyState>
              </div>
            ) : (
              <ul className="manifold" id="manifold">
                {repos.map((repo) => {
                  const count = openByRepo.get(repo.name) ?? 0;
                  const state = repo.archived ? "shut" : count > 0 ? "flowing" : "idle";
                  return (
                    <li
                      className={`fitting fitting-${state}`}
                      data-filter={`${repo.name} ${repo.description}`}
                      key={repo.id}
                    >
                      <span aria-hidden="true" className="valve">
                        <span className="valve-animal">{animalFor(repo.name)}</span>
                      </span>
                      <div className="fitting-main">
                        <div className="fitting-title">
                          <a href={`/${repo.owner}/${repo.name}`}>{repo.name}</a>
                          {repo.visibility === "public" ? (
                            <Badge icon="globe">Public</Badge>
                          ) : (
                            <Badge icon="lock">Private</Badge>
                          )}
                          {repo.archived ? <Badge tone="warning">Archived</Badge> : null}
                        </div>
                        {repo.description ? (
                          <p className="fitting-description">{repo.description}</p>
                        ) : null}
                        <p className="fitting-meta">
                          <span>
                            <Icon name="branch" size={13} /> {repo.defaultBranch}
                          </span>
                          <span>
                            Updated <TimeAgo value={repo.updatedAt} />
                          </span>
                        </p>
                      </div>
                      {count > 0 ? (
                        <a className="fitting-pulls" href={`/${repo.owner}/${repo.name}/pulls`}>
                          <Icon name="pull" /> {plural(count, "open pull request")}
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <aside className="home-aside">
            <section aria-labelledby="waiting-heading" className="panel">
              <h2 id="waiting-heading">Waiting on you</h2>
              {toReview.length === 0 && mine.length === 0 ? (
                <p className="panel-empty">
                  Nothing needs your review, and you have no open pull requests.
                </p>
              ) : (
                <ul className="panel-list">
                  {toReview.map((pull) => (
                    <PullItem
                      key={pull.id}
                      note={`${logins.get(pull.authorId) ?? "Someone"} asked for a review`}
                      owner={organization.slug}
                      pull={pull}
                    />
                  ))}
                  {mine.map((pull) => (
                    <PullItem
                      key={pull.id}
                      note="Your pull request"
                      owner={organization.slug}
                      pull={pull}
                    />
                  ))}
                </ul>
              )}
            </section>

            {activity.length ? (
              <section aria-labelledby="activity-heading" className="panel">
                <h2 id="activity-heading">Recent activity</h2>
                <ol className="feed">
                  {activity.map(({ event, repo, line }) => {
                    const who = event.actorId ? (logins.get(event.actorId) ?? "someone") : "forgit";
                    const pull = line.pull ? titles.get(`${repo}#${line.pull}`) : undefined;
                    return (
                      <li key={event.id}>
                        <Avatar name={who} size={22} />
                        <p>
                          <strong>{who}</strong> {line.verb}{" "}
                          {line.pull ? (
                            <a href={`/${organization.slug}/${repo}/pull/${line.pull}`}>
                              {pull ? pull.title : `#${line.pull}`}
                            </a>
                          ) : (
                            <a href={`/${organization.slug}/${repo}`}>{repo}</a>
                          )}
                          {line.pull ? <span className="feed-repo"> in {repo}</span> : null}
                          <span className="feed-time">
                            <TimeAgo value={event.createdAt} />
                          </span>
                        </p>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ) : null}

            {setupLeft > 0 ? (
              <section aria-labelledby="setup-heading" className="panel">
                <h2 id="setup-heading">Finish setting up</h2>
                <ul className="checklist">
                  {setup.map((step) => (
                    <li className={step.done ? "done" : undefined} key={step.label}>
                      <Icon name={step.done ? "checkCircle" : "circle"} />
                      {step.done ? <span>{step.label}</span> : <a href={step.href}>{step.label}</a>}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <details className="panel panel-details">
              <summary>
                <h2>Command-line setup</h2>
                <Icon name="chevronDown" />
              </summary>
              <p>Use an access token as your Git password, or point gh at this instance:</p>
              <CodeBlock
                code={`export GH_HOST=${host}\nexport GH_ENTERPRISE_TOKEN=<token>\ngh config set git_protocol https --host ${host}`}
              />
            </details>
          </aside>
        </div>
      </div>
    </Shell>
  );
}

function PullItem({
  pull,
  owner,
  note,
}: {
  pull: PullRequest & { repo: string };
  owner: string;
  note: string;
}) {
  return (
    <li>
      <Icon className={`icon pr-icon-${pull.state}`} name={PULL_ICON[pull.state]} />
      <div>
        <a href={`/${owner}/${pull.repo}/pull/${pull.number}`}>{pull.title}</a>
        <p>
          {note} in {pull.repo}, <TimeAgo value={pull.updatedAt} />
        </p>
      </div>
    </li>
  );
}

function summary(repos: number, review: number, mine: number, people: number): string {
  const parts = [
    plural(repos, "repository", "repositories"),
    review === 0 ? "nothing waiting on your review" : `${plural(review, "pull request")} to review`,
  ];
  if (mine) parts.push(`you have ${plural(mine, "open pull request")}`);
  return `${parts.join(", ")}. ${plural(people, "person", "people")} in this organization.`;
}
