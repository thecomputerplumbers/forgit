import { openPullAction } from "@/app/actions";
import { Icon } from "@/components/icons";
import { RepoHeader } from "@/components/repo";
import { Shell } from "@/components/shell";
import { Alert, Box, EmptyState, Field } from "@/components/ui";
import { loadGit } from "@/lib/git-view";
import { loadRepoPage } from "@/lib/repo-page";

export const metadata = { title: "New pull request" };

export default async function NewPullPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ error?: string; head?: string }>;
}) {
  const { owner, repo: name } = await params;
  const { error, head } = await searchParams;
  const { services, user, organization, repo } = await loadRepoPage(owner, name);
  const listed = await loadGit(() => services.git.branches(owner, name));
  const branches = "value" in listed ? listed.value.map((branch) => branch.name) : [];
  const heads = branches.filter((branch) => branch !== repo.defaultBranch);
  return (
    <Shell organization={organization} user={user}>
      <RepoHeader current="Pull requests" owner={owner} repo={repo} />
      <div className="container container-narrow page">
        <div className="page-header">
          <div>
            <h1>Open a pull request</h1>
            <p>Propose merging a branch. It is squash-merged once it meets the branch rules.</p>
          </div>
        </div>
        {"message" in listed ? (
          <Alert title="Git storage did not answer">{listed.message}</Alert>
        ) : heads.length === 0 ? (
          <Box>
            <EmptyState icon="branch" title="Push a branch first">
              A pull request needs a branch other than <code>{repo.defaultBranch}</code>. Create one
              and push it:
              <br />
              <code>git switch -c my-change && git push -u origin my-change</code>
            </EmptyState>
          </Box>
        ) : (
          <Box>
            <form action={openPullAction} className="form">
              {error ? <Alert title="Could not open the pull request">{error}</Alert> : null}
              <input name="owner" type="hidden" value={owner} />
              <input name="repo" type="hidden" value={name} />
              <div className="form-row" style={{ alignItems: "end" }}>
                <Field label="Base (merge into)">
                  <select defaultValue={repo.defaultBranch} name="base">
                    {branches.map((branch) => (
                      <option key={branch}>{branch}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Compare (your changes)">
                  <select defaultValue={head && heads.includes(head) ? head : heads[0]} name="head">
                    {heads.map((branch) => (
                      <option key={branch}>{branch}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Title">
                <input
                  autoFocus
                  name="title"
                  placeholder="Describe the change in a sentence"
                  required
                />
              </Field>
              <Field
                hint="Markdown is supported."
                label={
                  <>
                    Description <span className="optional">(optional)</span>
                  </>
                }
              >
                <textarea
                  name="body"
                  placeholder="Why is this change needed? How was it tested?"
                  rows={8}
                />
              </Field>
              <div className="form-actions">
                <button className="btn btn-success" type="submit">
                  <Icon name="pull" /> Open pull request
                </button>
                <a className="btn btn-ghost" href={`/${owner}/${name}/pulls`}>
                  Cancel
                </a>
              </div>
            </form>
          </Box>
        )}
      </div>
    </Shell>
  );
}
