import type { CheckRun, PullRequest, RepoRules, Review } from "./types.ts";

export type CheckState = "passed" | "failed" | "pending" | "missing";

export type MergePolicy = {
  /** Distinct approvers other than the author, counting only current-head approvals when stale reviews are dismissed. */
  approvals: number;
  requiredApprovals: number;
  changesRequested: boolean;
  checks: Array<{ name: string; state: CheckState }>;
  /** The first reason a merge is refused, in the order the merge enforces them. */
  blocker: { message: string; code: "reviews" | "checks" } | null;
};

export function evaluateMergePolicy(
  rules: RepoRules,
  pr: Pick<PullRequest, "authorId" | "headSha">,
  reviews: Review[],
  checks: CheckRun[],
): MergePolicy {
  const approvers = new Set(
    reviews
      .filter(
        (review) =>
          review.state === "approved" &&
          (!rules.dismissStaleReviews || review.headSha === pr.headSha),
      )
      .map((review) => review.authorId),
  );
  approvers.delete(pr.authorId);
  const changesRequested = reviews.some(
    (review) => review.state === "changes_requested" && review.headSha === pr.headSha,
  );
  const required = rules.requiredChecks.map((name) => {
    const run = checks.find(
      (check) =>
        check.name === name && (!name.startsWith("actions/") || check.producer === "actions"),
    );
    const state: CheckState = !run
      ? "missing"
      : run.status !== "completed"
        ? "pending"
        : run.conclusion === "success"
          ? "passed"
          : "failed";
    return { name, state };
  });
  const unpassed = required.find((check) => check.state !== "passed");
  // An unprotected default branch merges like GitHub without branch protection.
  const blocker = !rules.protectDefaultBranch
    ? null
    : approvers.size < rules.requiredApprovals
      ? { message: "Required approvals are missing", code: "reviews" as const }
      : changesRequested
        ? { message: "Changes have been requested", code: "reviews" as const }
        : unpassed
          ? { message: `Required check ${unpassed.name} has not passed`, code: "checks" as const }
          : null;
  return {
    approvals: approvers.size,
    requiredApprovals: rules.requiredApprovals,
    changesRequested,
    checks: required,
    blocker,
  };
}
