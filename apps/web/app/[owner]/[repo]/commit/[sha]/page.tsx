import { notFound } from "next/navigation";

import { CopyButton } from "@/components/client";
import { DiffView } from "@/components/diff";
import { Icon } from "@/components/icons";
import { RepoHeader } from "@/components/repo";
import { Shell } from "@/components/shell";
import { Alert, Avatar, Box, Sha, TimeAgo } from "@/components/ui";
import { loadGit } from "@/lib/git-view";
import { loadRepoPage } from "@/lib/repo-page";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string; sha: string }>;
}) {
  const { owner, repo, sha } = await params;
  return { title: `${sha.slice(0, 7)} · ${owner}/${repo}` };
}

export default async function CommitPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; sha: string }>;
}) {
  const { owner, repo: name, sha } = await params;
  const { services, user, organization, repo } = await loadRepoPage(owner, name);
  const listed = await loadGit(() => services.git.commit(owner, name, sha));
  if ("value" in listed && !listed.value) notFound();
  const detail = "value" in listed ? listed.value : null;
  const checks = await services.store.listChecks(repo.id, sha);
  return (
    <Shell organization={organization} user={user}>
      <RepoHeader current="Commits" owner={owner} repo={repo} />
      <div className="container page stack">
        {"message" in listed ? (
          <Alert title="Git storage did not answer">{listed.message}</Alert>
        ) : null}
        {checks.some((c) => c.actionRunId) ? (
          <Box title="Actions">
            <ul>
              {checks
                .filter((c) => c.actionRunId)
                .map((c) => (
                  <li key={c.id}>
                    <a href={`/${owner}/${name}/actions/${c.actionRunId}`}>{c.name}</a> ·{" "}
                    {c.conclusion ?? c.status}
                  </li>
                ))}
            </ul>
          </Box>
        ) : null}
        {detail ? (
          <>
            <Box>
              <div className="commit-hero">
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <h1 style={{ flex: 1 }}>{detail.commit.subject}</h1>
                  <a className="btn btn-sm" href={`/${owner}/${name}/tree/${detail.commit.sha}`}>
                    <Icon name="code" /> Browse files
                  </a>
                </div>
                {detail.commit.body ? (
                  <pre className="commit-body">{detail.commit.body}</pre>
                ) : null}
                <div className="commit-hero-meta">
                  <Avatar name={detail.commit.author} size={22} />
                  <strong title={detail.commit.authorEmail}>{detail.commit.author}</strong>
                  committed <TimeAgo value={detail.commit.authorDate} />
                  <span className="spacer" />
                  {detail.commit.parents.length ? (
                    <span className="row" style={{ gap: 6 }}>
                      {detail.commit.parents.length === 1 ? "Parent" : "Parents"}
                      {detail.commit.parents.map((parent) => (
                        <Sha
                          href={`/${owner}/${name}/commit/${parent}`}
                          key={parent}
                          sha={parent}
                        />
                      ))}
                    </span>
                  ) : (
                    <span>Root commit</span>
                  )}
                  <span className="row" style={{ gap: 2 }}>
                    Commit <code className="sha-chip">{detail.commit.sha.slice(0, 12)}</code>
                    <CopyButton label="Copy full SHA" value={detail.commit.sha} />
                  </span>
                </div>
              </div>
            </Box>
            <DiffView patch={detail.patch} />
          </>
        ) : null}
      </div>
    </Shell>
  );
}
