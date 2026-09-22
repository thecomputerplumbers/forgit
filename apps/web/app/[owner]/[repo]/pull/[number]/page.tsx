import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { commentAction, mergeAction, reviewAction } from "@/app/actions";
import { Patch, RepoNav, Shell } from "@/components/shell";
import { loadGit } from "@/lib/git-view";
import { requireOrganization } from "@/lib/session";

export default async function PullPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string; number: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { owner, repo: name, number } = await params;
  const { error } = await searchParams;
  const { services, actor, user } = await requireOrganization();
  const loaded = await services.requireRepo(actor, owner, name, "read").catch(() => null);
  if (!loaded) notFound();
  const synced = await loadGit(() => services.syncPullRequest(owner, name, Number(number)));
  const pull =
    "value" in synced
      ? synced.value
      : await services.store.getPullRequest(loaded.repo.id, Number(number));
  if (!pull) notFound();
  const reviews = await services.store.listReviews(pull.id);
  const comments = await services.store.listComments(pull.id);
  const checks = await services.store.listChecks(loaded.repo.id, pull.headSha);
  const compared =
    "message" in synced
      ? synced
      : await loadGit(() => services.git.compare(owner, name, pull.baseSha, pull.headSha));
  const patch = "value" in compared ? (compared.value?.patch ?? "") : "";
  const conflicts = "value" in compared && compared.value?.mergeable === false;
  const gitMessage = "message" in compared ? compared.message : null;
  const rules = await services.store.getRules(loaded.repo.id);
  const host = (await headers()).get("host") ?? owner;
  return (
    <Shell host={host} login={user.login}>
      <div className="sheet-head">
        <h1>
          {pull.title} <span className="sha">#{pull.number}</span>
        </h1>
        <p className={`state-${pull.state}`}>{pull.state}</p>
        <p className="muted">
          {pull.sourceRef} into {pull.targetRef}
        </p>
        <p className="sha">
          base {pull.baseSha.slice(0, 12)} · head {pull.headSha.slice(0, 12)}
        </p>
        {pull.body ? <pre className="readme">{pull.body}</pre> : null}
      </div>
      <RepoNav owner={owner} name={name} current="Pulls" />
      {error ? <p className="error">{error}</p> : null}
      {gitMessage ? <p className="error">{gitMessage}</p> : null}
      {conflicts ? <p className="error">This pull request has conflicts.</p> : null}
      <div className="pad">
        <p>
          Approvals required: {rules.requiredApprovals}. Checks required:{" "}
          {rules.requiredChecks.join(", ") || "none"}.
        </p>
      </div>
      {checks.map((check) => (
        <div className="check" key={check.id}>
          <strong>{check.name}</strong> {check.status} {check.conclusion ?? ""}{" "}
          <span className="sha">{check.headSha.slice(0, 12)}</span>
          {check.summary ? <p>{check.summary}</p> : null}
        </div>
      ))}
      {reviews.map((review) => (
        <div className="comment" key={review.id}>
          <strong>{review.state}</strong> on{" "}
          <span className="sha">{review.headSha.slice(0, 12)}</span>
          {review.body ? <p>{review.body}</p> : null}
        </div>
      ))}
      {comments.map((comment) => (
        <div className="comment" key={comment.id}>
          <span className="sha">{comment.path}</span>
          <p>{comment.body}</p>
        </div>
      ))}
      <Patch patch={patch} />
      {pull.state === "open" ? (
        <>
          <form action={reviewAction} className="stack">
            <input type="hidden" name="owner" value={owner} />
            <input type="hidden" name="repo" value={name} />
            <input type="hidden" name="number" value={pull.number} />
            <label>
              Review
              <textarea name="body" />
            </label>
            <label>
              Decision
              <select name="state">
                <option value="approved">Approve</option>
                <option value="changes_requested">Request changes</option>
                <option value="commented">Comment</option>
              </select>
            </label>
            <button type="submit">Submit review</button>
          </form>
          <form action={commentAction} className="stack">
            <input type="hidden" name="owner" value={owner} />
            <input type="hidden" name="repo" value={name} />
            <input type="hidden" name="number" value={pull.number} />
            <label>
              File
              <input name="path" defaultValue="README.md" />
            </label>
            <label>
              Comment
              <textarea name="body" required />
            </label>
            <button className="quiet" type="submit">
              Add file comment
            </button>
          </form>
          <form action={mergeAction} className="stack">
            <input type="hidden" name="owner" value={owner} />
            <input type="hidden" name="repo" value={name} />
            <input type="hidden" name="number" value={pull.number} />
            <button type="submit">Squash and merge</button>
          </form>
        </>
      ) : null}
    </Shell>
  );
}
