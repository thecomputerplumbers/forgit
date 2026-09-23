import type { GitCommit } from "@forgit/git-client";

import { CopyButton } from "@/components/client";
import { Icon } from "@/components/icons";
import { RefPicker, RepoHeader } from "@/components/repo";
import { Shell } from "@/components/shell";
import { Alert, Avatar, Box, EmptyState, Sha, TimeAgo } from "@/components/ui";
import { formatDay } from "@/lib/format";
import { loadGit } from "@/lib/git-view";
import { resolveSlug } from "@/lib/ref-path";
import { loadRepoPage } from "@/lib/repo-page";

const PAGE_SIZE = 35;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  return { title: `Commits · ${owner}/${repo}` };
}

export default async function CommitsPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string; slug?: string[] }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { owner, repo: name, slug } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const { services, user, organization, repo } = await loadRepoPage(owner, name);
  const { ref, branches, tags } = await resolveSlug(
    services.git,
    owner,
    name,
    slug ?? [],
    repo.defaultBranch,
  );
  const listed = await loadGit(() =>
    services.git.commits(owner, name, ref, (page - 1) * PAGE_SIZE, PAGE_SIZE),
  );
  const result = "value" in listed ? listed.value : null;
  const groups = new Map<string, GitCommit[]>();
  for (const commit of result?.commits ?? []) {
    const day = formatDay(commit.authorDate);
    groups.set(day, [...(groups.get(day) ?? []), commit]);
  }
  const base = `/${owner}/${name}/commits/${ref}`;
  return (
    <Shell organization={organization} user={user}>
      <RepoHeader current="Commits" owner={owner} repo={repo} />
      <div className="container page">
        <div className="toolbar">
          <RefPicker
            branches={branches}
            current={ref}
            hrefFor={(next) => `/${owner}/${name}/commits/${next}`}
            tags={tags}
          />
        </div>
        {"message" in listed ? (
          <Alert title="Git storage did not answer">{listed.message}</Alert>
        ) : groups.size === 0 ? (
          <Box>
            <EmptyState icon="commit" title="No commits yet">
              Commits pushed to <code>{ref}</code> will show up here.
            </EmptyState>
          </Box>
        ) : (
          [...groups].map(([day, commits]) => (
            <section className="commit-group" key={day}>
              <h2 className="commit-group-head">
                <Icon name="commit" /> Commits on {day}
              </h2>
              <Box flush>
                <ul className="list">
                  {commits.map((commit) => (
                    <li key={commit.sha}>
                      <div className="list-main">
                        <a
                          className="commit-subject"
                          href={`/${owner}/${name}/commit/${commit.sha}`}
                        >
                          {commit.subject}
                        </a>
                        <div className="list-meta">
                          <Avatar name={commit.author} size={16} />
                          <strong style={{ color: "var(--text-2)" }}>{commit.author}</strong>
                          committed <TimeAgo value={commit.authorDate} />
                        </div>
                      </div>
                      <div className="list-side">
                        <Sha href={`/${owner}/${name}/commit/${commit.sha}`} sha={commit.sha} />
                        <CopyButton label="Copy full SHA" value={commit.sha} />
                        <a
                          aria-label="Browse files at this commit"
                          className="btn btn-icon btn-ghost"
                          href={`/${owner}/${name}/tree/${commit.sha}`}
                          title="Browse files at this commit"
                        >
                          <Icon name="code" />
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              </Box>
            </section>
          ))
        )}
        {page > 1 || result?.more ? (
          <nav aria-label="Pagination" className="pager">
            {page > 1 ? (
              <a className="btn btn-sm" href={page === 2 ? base : `${base}?page=${page - 1}`}>
                <Icon name="chevronLeft" /> Newer
              </a>
            ) : (
              <span aria-disabled="true" className="btn btn-sm">
                <Icon name="chevronLeft" /> Newer
              </span>
            )}
            {result?.more ? (
              <a className="btn btn-sm" href={`${base}?page=${page + 1}`}>
                Older <Icon name="chevronRight" />
              </a>
            ) : (
              <span aria-disabled="true" className="btn btn-sm">
                Older <Icon name="chevronRight" />
              </span>
            )}
          </nav>
        ) : null}
      </div>
    </Shell>
  );
}
