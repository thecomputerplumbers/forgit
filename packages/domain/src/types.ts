import type { Scope } from "@forgit/auth/scopes";

export type OrgRole = "owner" | "admin" | "member";
export type RepoRole = "read" | "write" | "admin";
export type PullState = "open" | "closed" | "merged";
export type ReviewState = "approved" | "changes_requested" | "commented";
export type CheckStatus = "queued" | "in_progress" | "completed";
export type CheckConclusion = "success" | "failure" | "cancelled" | "skipped" | "neutral";

export type User = { id: string; name: string; email: string; login: string };

export type Organization = { id: string; name: string; slug: string };

export type OrgMember = { organizationId: string; userId: string; role: OrgRole };

export type Repository = {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  defaultBranch: string;
  visibility: "private" | "public";
  archived: boolean;
  backingId: string;
  nextPrNumber: number;
  createdAt: number;
  updatedAt: number;
};

export type RepoMember = {
  repositoryId: string;
  userId: string;
  role: RepoRole;
};

export type RepoRules = {
  repositoryId: string;
  requiredApprovals: number;
  requiredChecks: string[];
  dismissStaleReviews: boolean;
};

export type PullRequest = {
  id: string;
  repositoryId: string;
  number: number;
  title: string;
  body: string;
  authorId: string;
  sourceRef: string;
  targetRef: string;
  baseSha: string;
  headSha: string;
  state: PullState;
  mergeSha: string | null;
  idempotencyKey: string | null;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  mergedAt: number | null;
};

export type Review = {
  id: string;
  pullRequestId: string;
  authorId: string;
  headSha: string;
  state: ReviewState;
  body: string;
  createdAt: number;
};

export type Comment = {
  id: string;
  pullRequestId: string;
  authorId: string;
  path: string;
  line: number | null;
  body: string;
  commitSha: string;
  createdAt: number;
};

export type CheckRun = {
  id: string;
  repositoryId: string;
  name: string;
  headSha: string;
  status: CheckStatus;
  conclusion: CheckConclusion | null;
  title: string;
  summary: string;
  startedAt: number;
  completedAt: number | null;
};

export type Annotation = {
  id: string;
  checkRunId: string;
  path: string;
  startLine: number | null;
  endLine: number | null;
  message: string;
  level: "notice" | "warning" | "failure";
};

export type ApiToken = {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  hash: string;
  scopes: Scope[];
  repositoryIds: string[] | null;
  kind: "personal" | "machine";
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
};

export type Webhook = {
  id: string;
  repositoryId: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  createdAt: number;
};

export type AuditEvent = {
  id: string;
  actorId: string | null;
  action: string;
  repositoryId: string | null;
  target: string;
  metadata: Record<string, string | number | boolean | null>;
  requestId: string | null;
  createdAt: number;
};

export type Actor = {
  userId: string;
  login: string;
  tokenId?: string;
  /**
   * Null for a browser session: repository role decides.
   * Set for a token: intersected with the repository role.
   */
  tokenScopes: Scope[] | null;
  repositoryIds: string[] | null;
};

export class ForgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ForgeError";
  }
}
