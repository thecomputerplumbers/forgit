import { CodeBlock, CopyField } from "@/components/client";
import { Icon } from "@/components/icons";
import { RepoHeader } from "@/components/repo";
import { Shell } from "@/components/shell";
import { Alert, Box, EmptyState } from "@/components/ui";
import { loadGit } from "@/lib/git-view";
import { plural } from "@/lib/format";
import { resolveSlug } from "@/lib/ref-path";
import { loadRepoPage } from "@/lib/repo-page";

import { CodeBrowser } from "./code";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  return { title: `${owner}/${repo}` };
}

export default async function RepositoryPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo: name } = await params;
  const { services, user, organization, repo } = await loadRepoPage(owner, name);
  const [summaryResult, refs, openPulls] = await Promise.all([
    loadGit(() => services.git.summary(owner, name)),
    resolveSlug(services.git, owner, name, [], repo.defaultBranch),
    services.store.listPullRequests(repo.id, "open"),
  ]);
  const summary = "value" in summaryResult ? summaryResult.value : null;
  const head = summary?.head?.name ?? null;
  const treeResult = head ? await loadGit(() => services.git.tree(owner, name, head, "")) : null;
  const tree = treeResult && "value" in treeResult ? treeResult.value : null;
  const gitMessage =
    "message" in summaryResult
      ? summaryResult.message
      : treeResult && "message" in treeResult
        ? treeResult.message
        : null;
  const clone = services.cloneUrl(owner, name);
  const about = (
    <Box>
      <div className="about">
        <div className="about-section">
          <h2>About</h2>
          <p>{repo.description || <span className="muted">No description provided.</span>}</p>
          <ul className="about-list">
            <li>
              <Icon name={repo.visibility === "public" ? "globe" : "lock"} />
              {repo.visibility === "public" ? "Public" : "Private"} repository
            </li>
            <li>
              <Icon name="shieldCheck" />
              <span>
                <code>{repo.defaultBranch}</code> is protected
              </span>
            </li>
            {summary ? (
              <>
                <li>
                  <Icon name="branch" />
                  <a href={`/${owner}/${name}/branches`}>
                    {plural(summary.branches, "branch", "branches")}
                  </a>
                </li>
                <li>
                  <Icon name="tag" />
                  <a href={`/${owner}/${name}/tags`}>{plural(summary.tags, "tag")}</a>
                </li>
              </>
            ) : null}
          </ul>
        </div>
        <div className="about-section">
          <h3>Clone</h3>
          <CopyField label="HTTPS clone URL" value={clone} />
          <p className="about-hint">
            Use a <a href="/settings/tokens">personal access token</a> as the password.
          </p>
        </div>
      </div>
    </Box>
  );
  return (
    <Shell organization={organization} user={user}>
      <RepoHeader current="Code" openPulls={openPulls.length} owner={owner} repo={repo} />
      <div className="container page">
        {repo.archived ? (
          <div style={{ marginBottom: 16 }}>
            <Alert title="This repository is archived" tone="warning">
              It is read-only. Pushes, pull requests, and settings changes are disabled.
            </Alert>
          </div>
        ) : null}
        {gitMessage && !summary ? (
          <Alert title="Git storage did not answer">{gitMessage}</Alert>
        ) : !head ? (
          <div className="layout-sidebar">
            <Box flush>
              <EmptyState icon="terminal" title="This repository is empty">
                Push an existing project or start a new one from the command line.
              </EmptyState>
              <div className="stack" style={{ padding: "0 24px 24px" }}>
                <div>
                  <p className="field-label" style={{ marginBottom: 8 }}>
                    Push an existing repository
                  </p>
                  <CodeBlock
                    code={`git remote add origin ${clone}\ngit push -u origin ${repo.defaultBranch}`}
                  />
                </div>
                <div>
                  <p className="field-label" style={{ marginBottom: 8 }}>
                    Start a new repository
                  </p>
                  <CodeBlock
                    code={`echo "# ${name}" > README.md\ngit init -b ${repo.defaultBranch}\ngit add README.md\ngit commit -m "Initial commit"\ngit remote add origin ${clone}\ngit push -u origin ${repo.defaultBranch}`}
                  />
                </div>
                <p className="muted">
                  When Git asks for a password, paste a{" "}
                  <a href="/settings/tokens">personal access token</a>.
                </p>
              </div>
            </Box>
            <aside>{about}</aside>
          </div>
        ) : (
          <CodeBrowser
            aside={about}
            branches={refs.branches}
            error={gitMessage}
            name={name}
            owner={owner}
            path=""
            refName={head}
            tags={refs.tags}
            tree={tree}
          />
        )}
      </div>
    </Shell>
  );
}
