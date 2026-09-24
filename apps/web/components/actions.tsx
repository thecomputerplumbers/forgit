import { actionOperation } from "@/app/actions-ci";
import { Badge } from "@/components/ui";
import type { ActionRun } from "@forgit/actions";
export function RunStatus({
  status,
  conclusion,
}: {
  status: ActionRun["status"];
  conclusion: ActionRun["conclusion"];
}) {
  return (
    <Badge
      tone={
        conclusion === "success"
          ? "success"
          : conclusion === "failure" || conclusion === "infrastructure_error"
            ? "danger"
            : status === "completed"
              ? "neutral"
              : "warning"
      }
    >
      {conclusion ?? status.replaceAll("_", " ")}
    </Badge>
  );
}
export function ActionFields({
  owner,
  repo,
  operation,
  runId,
}: {
  owner: string;
  repo: string;
  operation: string;
  runId?: string;
}) {
  return (
    <>
      <input type="hidden" name="owner" value={owner} />
      <input type="hidden" name="repo" value={repo} />
      <input type="hidden" name="operation" value={operation} />
      {runId ? <input type="hidden" name="runId" value={runId} /> : null}
    </>
  );
}
export function RunButton({
  run,
  operation,
  label,
  jobId,
}: {
  run: ActionRun;
  operation: string;
  label: string;
  jobId?: string;
}) {
  return (
    <form action={actionOperation}>
      <ActionFields owner={run.owner} repo={run.repo} runId={run.id} operation={operation} />
      {jobId ? <input type="hidden" name="jobId" value={jobId} /> : null}
      <button className="btn btn-sm" type="submit">
        {label}
      </button>
    </form>
  );
}
