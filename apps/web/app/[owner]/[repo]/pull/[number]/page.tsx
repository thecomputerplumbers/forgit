import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { evaluateMergePolicy, type CheckRun, type ReviewState } from "@forgit/domain";

import { closePullAction, commentAction, mergeAction, reviewAction } from "@/app/actions";
import { DiffView } from "@/components/diff";
import { Icon, type IconName } from "@/components/icons";
import { Markdown } from "@/components/markdown";
import { PULL_ICON, RepoHeader } from "@/components/repo";
import { Shell } from "@/components/shell";
import { Alert, Avatar, Badge, Box, Sha, TimeAgo, type Tone } from "@/components/ui";
import { plural } from "@/lib/format";
import { loadGit } from "@/lib/git-view";
import { loadLogins, loadRepoPage } from "@/lib/repo-page";

const STATE_TONE: Record<string, Tone> = { open: "success", merged: "done", closed: "danger" };

const REVIEW: Record<ReviewState, { label: string; icon: IconName; tone: string }> = {
  approved: { label: "approved these changes", icon: "check", tone: "success" },
  changes_requested: { label: "requested changes", icon: "x", tone: "danger" },
  commented: { label: "reviewed", icon: "message", tone: "" },
};

function checkIcon(run: Pick<CheckRun, "status" | "conclusion">): [IconName, string] {
  if (run.status !== "completed") return ["clock", "check-pending"];
  if (run.conclusion === "success") return ["checkCircle", "check-success"];
  if (run.conclusion === "failure" || run.conclusion === "cancelled")
    return ["xCircle", "check-failure"];
  return ["circle", "muted"];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string; number: string }>;
}) {
  const { owner, repo, number } = await params;
  return { title: `#${number} · ${owner}/${repo}` };
}

export default async function PullPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string; number: string }>;
  searchParams: Promise<{ error?: string; tab?: string }>;
}) {
  const { owner, repo: name, number } = await params;
  const { error, tab } = await searchParams;
  const { services, user, organization, repo, role } = await loadRepoPage(owner, name);
  const synced = await loadGit(() => services.syncPullRequest(owner, name, Number(number)));
  const pull =
    "value" in synced ? synced.value : await services.store.getPullRequest(repo.id, Number(number));
  if (!pull) notFound();
  const [reviews, comments, checks, rules, compared] = await Promise.all([
    services.store.listReviews(pull.id),
    services.store.listComments(pull.id),
    services.store.listChecks(repo.id, pull.headSha),
    services.store.getRules(repo.id),
    "message" in synced
      ? Promise.resolve(synced)
      : loadGit(() => services.git.compare(owner, name, pull.baseSha, pull.headSha)),
  ]);
  const logins = await loadLogins(services.store, [
    pull.authorId,
    ...reviews.map((review) => review.authorId),
    ...comments.map((comment) => comment.authorId),
  ]);
  const comparison = "value" in compared ? compared.value : null;
  const gitMessage = "message" in compared ? compared.message : null;
  const conflicts = comparison?.mergeable === false;
  const policy = evaluateMergePolicy(rules, pull, reviews, checks);
  const files = comparison?.files ?? [];
  const canWrite = (role === "write" || role === "admin") && !repo.archived;
  const author = logins.get(pull.authorId) ?? "unknown";
  const base = `/${owner}/${name}/pull/${pull.number}`;
  const showFiles = tab === "files";
  const hidden = (
    <>
      <input name="owner" type="hidden" value={owner} />
      <input name="repo" type="hidden" value={name} />
      <input name="number" type="hidden" value={pull.number} />
    </>
  );

  const timeline = [
    ...reviews.map((review) => ({ at: review.createdAt, kind: "review" as const, review })),
    ...comments.map((comment) => ({ at: comment.createdAt, kind: "comment" as const, comment })),
  ].sort((left, right) => left.at - right.at);

  const latestReviews = new Map<string, ReviewState>();
  for (const review of [...reviews].sort((left, right) => left.createdAt - right.createdAt)) {
    if (review.state !== "commented" || !latestReviews.has(review.authorId))
      latestReviews.set(review.authorId, review.state);
  }

  const mergeReady = !policy.blocker && !conflicts && !gitMessage;

  // Line comments on the current head sit under their line in the diff.
  const threadComments = new Map<string, typeof comments>();
  for (const comment of comments) {
    if (!comment.line || comment.commitSha !== pull.headSha) continue;
    const key = `${comment.path}:${comment.line}`;
    threadComments.set(key, [...(threadComments.get(key) ?? []), comment]);
  }
  const threads = new Map<string, ReactNode>(
    [...threadComments].map(([key, list]) => [
      key,
      <div className="thread" key={key}>
        {list.map((comment) => (
          <div className="thread-comment" key={comment.id}>
            <div className="thread-comment-head">
              <Avatar name={logins.get(comment.authorId) ?? "?"} />
              <strong>{logins.get(comment.authorId)}</strong>
              <TimeAgo value={comment.createdAt} />
            </div>
            <div className="thread-comment-body">{comment.body}</div>
          </div>
        ))}
      </div>,
    ]),
  );

  return (
    <Shell organization={organization} user={user}>
      <RepoHeader current="Pull requests" owner={owner} repo={repo} />
      <div className="container page">
        <div className="pr-hero">
          <h1>
            {pull.title} <span className="muted">#{pull.number}</span>
          </h1>
          <div className="pr-hero-meta">
            <span className={`badge state badge-${STATE_TONE[pull.state]}`}>
              <Icon name={PULL_ICON[pull.state]} />
              {pull.state[0]?.toUpperCase()}
              {pull.state.slice(1)}
            </span>
            <span>
              <strong>{author}</strong>{" "}
              {pull.state === "merged"
                ? "merged"
                : pull.state === "open"
                  ? "wants to merge"
                  : "proposed merging"}{" "}
              <span className="branch-chip">{pull.sourceRef}</span> into{" "}
              <span className="branch-chip">{pull.targetRef}</span>
            </span>
            <span className="muted">
              ·{" "}
              {pull.state === "merged" && pull.mergedAt ? (
                <TimeAgo value={pull.mergedAt} />
              ) : (
                <TimeAgo value={pull.createdAt} />
              )}
            </span>
          </div>
        </div>

        <nav aria-label="Pull request" className="pr-tabs">
          <a aria-current={showFiles ? undefined : "page"} href={base}>
            <Icon name="message" /> Conversation{" "}
            <span className="counter">{reviews.length + comments.length}</span>
          </a>
          <a aria-current={showFiles ? "page" : undefined} href={`${base}?tab=files`}>
            <Icon name="diff" /> Files changed <span className="counter">{files.length}</span>
          </a>
        </nav>

        {error ? (
          <div style={{ marginBottom: 16 }}>
            <Alert title="That didn't work">{error}</Alert>
          </div>
        ) : null}
        {gitMessage ? (
          <div style={{ marginBottom: 16 }}>
            <Alert title="Git storage did not answer">{gitMessage}</Alert>
          </div>
        ) : null}

        {showFiles ? (
          <DiffView
            comments={
              pull.state === "open" && !repo.archived
                ? { owner, repo: name, number: pull.number, threads }
                : { owner, repo: name, number: pull.number, threads, readOnly: true }
            }
            patch={comparison?.patch ?? ""}
          />
        ) : (
          <div className="layout-sidebar">
            <div className="timeline">
              <div className="timeline-item">
                <Avatar name={author} size={32} />
                <div className="timeline-card">
                  <div className="timeline-card-head">
                    <strong>{author}</strong> opened this pull request{" "}
                    <TimeAgo value={pull.createdAt} />
                  </div>
                  {pull.body ? (
                    <div className="timeline-card-body markdown">
                      <Markdown
                        dir=""
                        root={`/${owner}/${name}/blob/${pull.sourceRef}`}
                        source={pull.body}
                      />
                    </div>
                  ) : (
                    <div className="timeline-card-body muted">No description provided.</div>
                  )}
                </div>
              </div>

              {timeline.map((entry) =>
                entry.kind === "review" ? (
                  <div className="timeline-item" key={entry.review.id}>
                    <Avatar name={logins.get(entry.review.authorId) ?? "?"} size={32} />
                    <div className="timeline-card">
                      <div className="timeline-card-head">
                        <span
                          className={`timeline-event-icon ${REVIEW[entry.review.state].tone}`}
                          style={{ width: 20, height: 20 }}
                        >
                          <Icon name={REVIEW[entry.review.state].icon} size={12} />
                        </span>
                        <strong>{logins.get(entry.review.authorId)}</strong>
                        {REVIEW[entry.review.state].label}
                        <TimeAgo value={entry.review.createdAt} />
                        <span className="spacer" />
                        {entry.review.headSha !== pull.headSha ? <Badge>Outdated</Badge> : null}
                        <Sha sha={entry.review.headSha} />
                      </div>
                      {entry.review.body ? (
                        <div className="timeline-card-body">{entry.review.body}</div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="timeline-item" key={entry.comment.id}>
                    <Avatar name={logins.get(entry.comment.authorId) ?? "?"} size={32} />
                    <div className="timeline-card">
                      <div className="timeline-card-head">
                        <strong>{logins.get(entry.comment.authorId)}</strong> commented on{" "}
                        {entry.comment.line ? (
                          <a href={`${base}?tab=files`}>
                            <code>
                              {entry.comment.path}:{entry.comment.line}
                            </code>
                          </a>
                        ) : (
                          <code>{entry.comment.path}</code>
                        )}
                        <TimeAgo value={entry.comment.createdAt} />
                        {entry.comment.commitSha !== pull.headSha ? (
                          <>
                            <span className="spacer" />
                            <Badge>Outdated</Badge>
                          </>
                        ) : null}
                      </div>
                      <div className="timeline-card-body">{entry.comment.body}</div>
                    </div>
                  </div>
                ),
              )}

              {pull.state === "merged" ? (
                <div className="timeline-event">
                  <span className="timeline-event-icon done">
                    <Icon name="merge" />
                  </span>
                  <span>
                    Squash-merged into <span className="branch-chip">{pull.targetRef}</span>
                    {pull.mergeSha ? (
                      <>
                        {" "}
                        as{" "}
                        <Sha
                          href={`/${owner}/${name}/commit/${pull.mergeSha}`}
                          sha={pull.mergeSha}
                        />
                      </>
                    ) : null}{" "}
                    {pull.mergedAt ? <TimeAgo value={pull.mergedAt} /> : null}
                  </span>
                </div>
              ) : pull.state === "closed" ? (
                <div className="timeline-event">
                  <span className="timeline-event-icon danger">
                    <Icon name="pullClosed" />
                  </span>
                  <span>Closed {pull.closedAt ? <TimeAgo value={pull.closedAt} /> : null}</span>
                </div>
              ) : null}

              {pull.state === "open" ? (
                <div className="merge-box">
                  <div className="merge-row">
                    <span
                      className={`merge-status ${policy.changesRequested ? "bad" : policy.approvals >= policy.requiredApprovals ? "ok" : "wait"}`}
                    >
                      <Icon
                        name={
                          policy.changesRequested
                            ? "x"
                            : policy.approvals >= policy.requiredApprovals
                              ? "check"
                              : "eye"
                        }
                      />
                    </span>
                    <div>
                      <strong>
                        {policy.changesRequested
                          ? "Changes requested"
                          : policy.approvals >= policy.requiredApprovals
                            ? policy.requiredApprovals
                              ? "Changes approved"
                              : "No review required"
                            : "Review required"}
                      </strong>
                      <p>
                        {plural(policy.approvals, "approval")} of {policy.requiredApprovals}{" "}
                        required
                        {rules.dismissStaleReviews ? " on the latest commit" : ""}. Authors can't
                        approve their own changes.
                      </p>
                    </div>
                  </div>
                  <div className="merge-row">
                    <span
                      className={`merge-status ${policy.checks.some((check) => check.state === "failed") ? "bad" : policy.checks.every((check) => check.state === "passed") ? "ok" : "wait"}`}
                    >
                      <Icon
                        name={
                          policy.checks.some((check) => check.state === "failed")
                            ? "x"
                            : policy.checks.every((check) => check.state === "passed")
                              ? "check"
                              : "clock"
                        }
                      />
                    </span>
                    <div>
                      <strong>
                        {policy.checks.length === 0
                          ? "No required checks"
                          : policy.checks.every((check) => check.state === "passed")
                            ? "All required checks passed"
                            : "Required checks have not passed"}
                      </strong>
                      {policy.checks.length ? (
                        <ul className="checks-list">
                          {policy.checks.map((check) => (
                            <li key={check.name}>
                              <Icon
                                className={`icon ${check.state === "passed" ? "check-success" : check.state === "failed" ? "check-failure" : "check-pending"}`}
                                name={
                                  check.state === "passed"
                                    ? "checkCircle"
                                    : check.state === "failed"
                                      ? "xCircle"
                                      : "clock"
                                }
                              />
                              <code>{check.name}</code>
                              <span className="muted">
                                {check.state === "missing" ? "Expected, not reported" : check.state}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>Admins can require checks in branch protection settings.</p>
                      )}
                    </div>
                  </div>
                  <div className="merge-row">
                    <span
                      className={`merge-status ${conflicts ? "bad" : gitMessage ? "wait" : "ok"}`}
                    >
                      <Icon name={conflicts ? "alert" : "check"} />
                    </span>
                    <div>
                      <strong>
                        {conflicts
                          ? "This branch has conflicts"
                          : gitMessage
                            ? "Conflict status unknown"
                            : "No conflicts with the base branch"}
                      </strong>
                      <p>
                        {conflicts
                          ? `Merge ${pull.targetRef} into ${pull.sourceRef} locally, resolve the conflicts, and push.`
                          : "The branch can be squash-merged cleanly."}
                      </p>
                    </div>
                  </div>
                  <div className="merge-foot">
                    {canWrite ? (
                      <div className="row">
                        <form action={mergeAction} className="row" style={{ flex: 1 }}>
                          {hidden}
                          <button className="btn btn-success" disabled={!mergeReady} type="submit">
                            <Icon name="merge" /> Squash and merge
                          </button>
                          <span className="muted" style={{ fontSize: 13 }}>
                            {mergeReady
                              ? `Commits are squashed into one commit on ${pull.targetRef}.`
                              : (policy.blocker?.message ?? "Resolve the items above to merge.")}
                          </span>
                        </form>
                        <form action={closePullAction}>
                          {hidden}
                          <button className="btn btn-danger" type="submit">
                            <Icon name="pullClosed" /> Close pull request
                          </button>
                        </form>
                      </div>
                    ) : (
                      <span className="muted">
                        {repo.archived
                          ? "This repository is archived."
                          : "You need write access to merge."}
                      </span>
                    )}
                  </div>
                </div>
              ) : null}

              {pull.state === "open" && !repo.archived ? (
                <Box title="Leave a review">
                  <form action={reviewAction} className="form">
                    {hidden}
                    <textarea
                      aria-label="Review comment"
                      name="body"
                      placeholder="Leave a comment"
                      rows={5}
                    />
                    <fieldset>
                      <legend className="sr-only">Decision</legend>
                      <div className="stack" style={{ gap: 10 }}>
                        <label className="check">
                          <input defaultChecked name="state" type="radio" value="commented" />
                          <span>
                            <strong>Comment</strong>{" "}
                            <span className="muted">General feedback without approval.</span>
                          </span>
                        </label>
                        <label className="check">
                          <input name="state" type="radio" value="approved" />
                          <span>
                            <strong>Approve</strong>{" "}
                            <span className="muted">These changes are ready to merge.</span>
                          </span>
                        </label>
                        <label className="check">
                          <input name="state" type="radio" value="changes_requested" />
                          <span>
                            <strong>Request changes</strong>{" "}
                            <span className="muted">Block merging until the author responds.</span>
                          </span>
                        </label>
                      </div>
                    </fieldset>
                    <div className="form-actions">
                      <button className="btn btn-primary" type="submit">
                        Submit review
                      </button>
                    </div>
                  </form>
                </Box>
              ) : null}

              {pull.state === "open" && !repo.archived && files.length ? (
                <Box
                  description={
                    <>
                      To comment on a single line, open{" "}
                      <a href={`${base}?tab=files`}>Files changed</a> and click <strong>+</strong>{" "}
                      beside it.
                    </>
                  }
                  title="Comment on a file"
                >
                  <form action={commentAction} className="form">
                    {hidden}
                    <select aria-label="File" name="path">
                      {files.map((file) => (
                        <option key={file.filename}>{file.filename}</option>
                      ))}
                    </select>
                    <textarea
                      aria-label="Comment"
                      name="body"
                      placeholder="What should change in this file?"
                      required
                      rows={4}
                    />
                    <div className="form-actions">
                      <button className="btn" type="submit">
                        Add file comment
                      </button>
                    </div>
                  </form>
                </Box>
              ) : null}
            </div>

            <aside>
              <Box>
                <div className="sidebar-section">
                  <h3>Reviewers</h3>
                  {latestReviews.size ? (
                    <ul>
                      {[...latestReviews].map(([authorId, state]) => (
                        <li key={authorId}>
                          <Avatar name={logins.get(authorId) ?? "?"} />
                          <span style={{ flex: 1 }}>{logins.get(authorId)}</span>
                          <Icon
                            className={`icon ${state === "approved" ? "check-success" : state === "changes_requested" ? "check-failure" : "muted"}`}
                            name={REVIEW[state].icon}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No reviews yet.</p>
                  )}
                </div>
                <div className="sidebar-section">
                  <h3>Checks</h3>
                  {checks.length ? (
                    <ul>
                      {checks.map((check) => {
                        const [icon, tone] = checkIcon(check);
                        return (
                          <li key={check.id} title={check.summary || check.title}>
                            <Icon className={`icon ${tone}`} name={icon} />
                            <span style={{ flex: 1 }}>{check.name}</span>
                            <span className="muted">
                              {check.conclusion ?? check.status.replace("_", " ")}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="muted">No checks reported for this commit.</p>
                  )}
                </div>
                <div className="sidebar-section">
                  <h3>Commits</h3>
                  <ul>
                    <li>
                      <span className="muted" style={{ width: 36 }}>
                        Head
                      </span>
                      <Sha href={`/${owner}/${name}/commit/${pull.headSha}`} sha={pull.headSha} />
                    </li>
                    <li>
                      <span className="muted" style={{ width: 36 }}>
                        Base
                      </span>
                      <Sha href={`/${owner}/${name}/commit/${pull.baseSha}`} sha={pull.baseSha} />
                    </li>
                  </ul>
                </div>
                <div className="sidebar-section">
                  <h3>Checkout locally</h3>
                  <code style={{ fontSize: 12, color: "var(--text-2)" }}>
                    gh pr checkout {pull.number}
                  </code>
                </div>
              </Box>
            </aside>
          </div>
        )}
      </div>
    </Shell>
  );
}
