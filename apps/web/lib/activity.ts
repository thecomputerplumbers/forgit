/** Audit events worth showing on the dashboard, phrased as what a person did. */
export type ActivityEvent = {
  action: string;
  target: string;
  metadata: Record<string, string | number | boolean | null>;
};

export type ActivityLine = {
  /** Verb phrase after the actor's name: "merged", "requested changes on". */
  verb: string;
  /** Pull request number when the event is about one. */
  pull?: number;
  /** Extra object after the verb, such as a login given access. */
  object?: string;
};

const REVIEW_VERBS: Record<string, string> = {
  approved: "approved",
  changes_requested: "requested changes on",
  commented: "reviewed",
};

export function describeActivity(event: ActivityEvent): ActivityLine | null {
  const pull = Number(event.target);
  switch (event.action) {
    case "repo.create":
      return { verb: "created" };
    case "repo.archive":
      return { verb: "archived" };
    case "repo.member":
      return {
        verb: `gave ${event.target} ${String(event.metadata.role ?? "read")} access to`,
      };
    case "pull_request.open":
      return { verb: "opened", pull };
    case "pull_request.merge":
      return { verb: "merged", pull };
    case "pull_request.close":
      return { verb: "closed", pull };
    case "pull_request.comment":
      return { verb: "commented on", pull };
    case "pull_request.review":
      return { verb: REVIEW_VERBS[String(event.metadata.state)] ?? "reviewed", pull };
    default:
      // Check runs, tokens, and webhooks are machine noise on a people-facing feed.
      return null;
  }
}
