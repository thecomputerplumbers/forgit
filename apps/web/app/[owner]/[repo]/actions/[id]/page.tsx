import { RunButton, RunStatus } from "@/components/actions";
import { RunRefresh, StepLog } from "@/components/actions-live";
import { RepoHeader } from "@/components/repo";
import { Shell } from "@/components/shell";
import { Alert, Box, TimeAgo } from "@/components/ui";
import { getActions } from "@/lib/actions";
import { loadRepoPage } from "@/lib/repo-page";
export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string; id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { owner, repo: name, id } = await params,
    { error } = await searchParams;
  const { actor, user, organization, repo, role } = await loadRepoPage(owner, name);
  const run = await getActions().get(actor, owner, name, id),
    base = `/${owner}/${name}/actions/${id}`,
    active = run.status !== "completed",
    write = role !== "read" && !repo.archived;
  return (
    <Shell organization={organization} user={user}>
      <RepoHeader current="Actions" owner={owner} repo={repo} />
      <div className="container page">
        <a href={`/${owner}/${name}/actions`}>← All runs</a>
        <div className="toolbar">
          <div>
            <h1>{run.workflow.name}</h1>
            <p className="muted">
              {run.ref} ·{" "}
              <a className="mono" href={`/${owner}/${name}/commit/${run.sha}`}>
                {run.sha.slice(0, 12)}
              </a>{" "}
              · attempt {run.attempt} · <TimeAgo value={run.createdAt} />
            </p>
          </div>
          <span className="spacer" />
          <RunStatus status={run.status} conclusion={run.conclusion} />
          {write ? (
            <RunButton
              run={run}
              operation={active ? "cancel" : "rerun"}
              label={active ? "Cancel run" : "Re-run workflow"}
            />
          ) : null}
          {write && run.healing?.status === "running" ? (
            <RunButton run={run} operation="cancel" label="Stop investigation" />
          ) : null}
        </div>
        <RunRefresh active={active || run.healing?.status === "running"} />
        {error || run.error ? <Alert title="Run details">{error ?? run.error}</Alert> : null}
        <div className="settings-sections" style={{ marginTop: 20 }}>
          {run.jobs.map((job) => {
            const definition = run.workflow.jobs.find((j) => j.id === job.id)!;
            return (
              <Box
                key={job.id}
                title={definition.name}
                description={
                  <>
                    <RunStatus status={job.status} conclusion={job.conclusion} />
                    {definition.needs.length ? ` · needs ${definition.needs.join(", ")}` : ""}
                    {definition.environment ? ` · environment ${definition.environment}` : ""}
                  </>
                }
              >
                {job.error ? <Alert title="Job error">{job.error}</Alert> : null}
                {active && definition.environment && !job.startedAt && role === "admin" ? (
                  <RunButton
                    run={run}
                    operation="approve"
                    label={job.approvedBy ? "Re-approve deployment" : "Approve deployment"}
                    jobId={job.id}
                  />
                ) : null}
                {job.steps.map((step) => (
                  <details
                    key={step.id}
                    open={step.status === "in_progress" || step.conclusion === "failure"}
                    style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}
                  >
                    <summary>
                      <RunStatus status={step.status} conclusion={step.conclusion} /> {step.name}
                      {step.startedAt
                        ? ` · ${Math.round(((step.completedAt ?? Date.now()) - step.startedAt) / 1000)}s`
                        : ""}
                    </summary>
                    <pre style={{ whiteSpace: "pre-wrap" }}>{step.command}</pre>
                    {step.logKey ? (
                      <>
                        <StepLog
                          url={`${base}/output?job=${job.id}&step=${step.id}`}
                          active={active && step.status !== "completed"}
                        />
                        <a href={`${base}/output?job=${job.id}&step=${step.id}`}>Raw log</a>
                      </>
                    ) : (
                      <p className="muted">No output yet.</p>
                    )}
                  </details>
                ))}
              </Box>
            );
          })}
          {run.healing ? (
            <Box title="Agent investigation" description={run.healing.status}>
              <p style={{ whiteSpace: "pre-wrap" }}>
                {run.healing.summary ??
                  run.healing.error ??
                  "Inspecting failure logs and source code…"}
              </p>
              {run.healing.pullNumber ? (
                <a className="btn" href={`/${owner}/${name}/pull/${run.healing.pullNumber}`}>
                  Review proposed fix #{run.healing.pullNumber}
                </a>
              ) : null}
              <p className="muted">
                The original run stays failed. Proposed fixes require review and their own checks.
              </p>
            </Box>
          ) : null}
          {run.artifacts.length ? (
            <Box title="Artifacts">
              <ul>
                {run.artifacts.map((a) => (
                  <li key={a.key}>
                    <a href={`${base}/output?artifact=${encodeURIComponent(a.name)}`}>{a.name}</a> ·{" "}
                    {a.bytes} bytes · <code>{a.digest.slice(0, 12)}</code>
                  </li>
                ))}
              </ul>
            </Box>
          ) : null}
        </div>
      </div>
    </Shell>
  );
}
