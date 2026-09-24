import { actionOperation } from "@/app/actions-ci";
import { ActionFields, RunStatus } from "@/components/actions";
import { RepoHeader } from "@/components/repo";
import { Shell } from "@/components/shell";
import { Alert, Box, EmptyState, Field, TimeAgo } from "@/components/ui";
import { getActions } from "@/lib/actions";
import { loadRepoPage } from "@/lib/repo-page";

export default async function ActionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ before?: string; error?: string }>;
}) {
  const { owner, repo: name } = await params,
    { before, error } = await searchParams;
  const { actor, user, organization, repo, role } = await loadRepoPage(owner, name);
  const actions = getActions(),
    runs = await actions.list(actor, owner, name, before ? Number(before) : undefined),
    settings = await actions.store.settings(repo.id);
  const base = `/${owner}/${name}/actions`;
  return (
    <Shell organization={organization} user={user}>
      <RepoHeader current="Actions" owner={owner} repo={repo} />
      <div className="container page">
        <div className="toolbar">
          <div>
            <h1>Actions</h1>
            <p className="muted">Build, test, deploy, and investigate failures.</p>
          </div>
          <span className="spacer" />
          {role === "admin" ? (
            <a className="btn" href={`${base}/settings`}>
              Actions settings
            </a>
          ) : null}
        </div>
        {error ? <Alert title="Actions request failed">{error}</Alert> : null}
        {!settings.enabled ? (
          <Alert title="Actions is disabled" tone="info">
            An administrator can enable runs and choose whether the agent diagnoses failures or
            proposes fix pull requests.
          </Alert>
        ) : null}
        {settings.enabled && role !== "read" && !repo.archived ? (
          <details className="box" style={{ padding: 16, marginBottom: 20 }}>
            <summary>Run workflow</summary>
            <form action={actionOperation} className="form">
              <ActionFields owner={owner} repo={name} operation="run" />
              <div className="form-row">
                <Field label="Workflow">
                  <input name="workflow" placeholder=".forgit/workflows/ci.yml" required />
                </Field>
                <Field label="Branch or tag">
                  <input name="ref" defaultValue={repo.defaultBranch} required />
                </Field>
              </div>
              <button className="btn btn-primary">Run workflow</button>
            </form>
          </details>
        ) : null}
        <Box flush>
          {runs.length ? (
            <ul className="list">
              {runs.map((run) => (
                <li key={run.id}>
                  <RunStatus status={run.status} conclusion={run.conclusion} />
                  <div className="list-main">
                    <a className="list-title" href={`${base}/${run.id}`}>
                      {run.workflow.name}
                    </a>
                    <div className="list-meta">
                      {run.trigger.replaceAll("_", " ")} · {run.ref.replace(/^refs\/heads\//, "")} ·{" "}
                      <a className="mono" href={`/${owner}/${name}/commit/${run.sha}`}>
                        {run.sha.slice(0, 8)}
                      </a>{" "}
                      · attempt {run.attempt} · <TimeAgo value={run.createdAt} />
                    </div>
                  </div>
                  {run.healing ? <span className="muted">Agent: {run.healing.status}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="checkCircle" title="No workflow runs yet">
              Add a workflow under <code>.forgit/workflows/</code> and push a branch to get started.
            </EmptyState>
          )}
        </Box>
        {runs.length === 30 ? (
          <a className="btn" href={`${base}?before=${runs.at(-1)!.ordinal}`}>
            Older runs
          </a>
        ) : null}
      </div>
    </Shell>
  );
}
