import { CopyButton, ListFilter } from "@/components/client";
import { Icon } from "@/components/icons";
import { RepoHeader } from "@/components/repo";
import { Shell } from "@/components/shell";
import { Alert, Badge, Box, EmptyState, Sha } from "@/components/ui";
import { plural } from "@/lib/format";
import { loadGit } from "@/lib/git-view";
import { loadRepoPage } from "@/lib/repo-page";

export default async function RefsPage({
  params,
  kind,
}: {
  params: Promise<{ owner: string; repo: string }>;
  kind: "branches" | "tags";
}) {
  const { owner, repo: name } = await params;
  const { services, user, organization, repo } = await loadRepoPage(owner, name);
  const [listed, rules] = await Promise.all([
    loadGit(() =>
      kind === "branches" ? services.git.branches(owner, name) : services.git.tags(owner, name),
    ),
    services.store.getRules(repo.id),
  ]);
  const refs = ("value" in listed ? listed.value : []).sort((left, right) =>
    left.name === repo.defaultBranch
      ? -1
      : right.name === repo.defaultBranch
        ? 1
        : left.name.localeCompare(right.name),
  );
  const branches = kind === "branches";
  return (
    <Shell organization={organization} user={user}>
      <RepoHeader current={branches ? "Branches" : "Tags"} owner={owner} repo={repo} />
      <div className="container page">
        {"message" in listed ? (
          <Alert title="Git storage did not answer">{listed.message}</Alert>
        ) : (
          <div className="stack">
            {refs.length > 5 ? (
              <ListFilter
                placeholder={branches ? "Find a branch…" : "Find a tag…"}
                target="ref-list"
              />
            ) : null}
            <Box
              actions={
                branches ? (
                  <a className="btn btn-sm" href={`/${owner}/${name}/pulls/new`}>
                    <Icon name="pull" /> New pull request
                  </a>
                ) : undefined
              }
              flush
              title={
                branches ? plural(refs.length, "branch", "branches") : plural(refs.length, "tag")
              }
            >
              {refs.length === 0 ? (
                <EmptyState
                  icon={branches ? "branch" : "tag"}
                  title={branches ? "No branches yet" : "No tags yet"}
                >
                  {branches
                    ? "Push a branch to see it here."
                    : "Push a tag with git push origin <tag> to mark a release."}
                </EmptyState>
              ) : (
                <ul className="list" id="ref-list">
                  {refs.map((ref) => (
                    <li data-filter={ref.name} key={ref.name}>
                      <Icon className="icon muted" name={branches ? "branch" : "tag"} />
                      <div className="list-main">
                        <div className="list-title">
                          <a href={`/${owner}/${name}/tree/${ref.name}`}>{ref.name}</a>
                          <CopyButton label="Copy name" value={ref.name} />
                          {branches && ref.name === repo.defaultBranch ? (
                            <>
                              <Badge tone="accent">Default</Badge>
                              {rules.protectDefaultBranch ? (
                                <Badge icon="shield">Protected</Badge>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </div>
                      <div className="list-side">
                        <Sha href={`/${owner}/${name}/commit/${ref.sha}`} sha={ref.sha} />
                        <a
                          className="btn btn-sm btn-ghost hide-sm"
                          href={`/${owner}/${name}/commits/${ref.name}`}
                        >
                          <Icon name="history" /> History
                        </a>
                        {branches && ref.name !== repo.defaultBranch ? (
                          <a
                            className="btn btn-sm"
                            href={`/${owner}/${name}/pulls/new?head=${encodeURIComponent(ref.name)}`}
                          >
                            <Icon name="pull" /> <span className="hide-sm">Pull request</span>
                          </a>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Box>
          </div>
        )}
      </div>
    </Shell>
  );
}
