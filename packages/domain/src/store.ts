import type {
  Annotation,
  ApiToken,
  AuditEvent,
  CheckRun,
  Comment,
  Organization,
  OrgMember,
  PullRequest,
  RepoMember,
  RepoRules,
  Repository,
  Review,
  User,
  Webhook,
  WebhookDelivery,
} from "./types.ts";

export interface ForgeStore {
  now(): number;

  getUser(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserByLogin(login: string): Promise<User | null>;
  upsertLogin(userId: string, login: string, createdAt: number): Promise<void>;

  getOrganization(id: string): Promise<Organization | null>;
  getOrganizationBySlug(slug: string): Promise<Organization | null>;
  listOrganizationsForUser(userId: string): Promise<Organization[]>;
  getOrgMember(organizationId: string, userId: string): Promise<OrgMember | null>;
  listOrgMembers(
    organizationId: string,
  ): Promise<Array<OrgMember & { email: string; name: string; login: string }>>;

  insertRepository(repo: Repository): Promise<void>;
  getRepository(id: string): Promise<Repository | null>;
  getRepositoryByName(organizationId: string, name: string): Promise<Repository | null>;
  listRepositoriesForOrg(organizationId: string): Promise<Repository[]>;
  listRepositoriesForUser(userId: string): Promise<Array<Repository & { owner: string }>>;
  updateRepository(
    id: string,
    patch: Partial<Pick<Repository, "description" | "archived" | "defaultBranch" | "visibility">>,
  ): Promise<void>;
  deleteRepository(id: string): Promise<void>;
  allocatePullNumber(repositoryId: string): Promise<number>;

  upsertRepoMember(member: RepoMember): Promise<void>;
  getRepoMember(repositoryId: string, userId: string): Promise<RepoMember | null>;
  listRepoMembers(
    repositoryId: string,
  ): Promise<Array<RepoMember & { login: string; email: string }>>;
  deleteRepoMember(repositoryId: string, userId: string): Promise<void>;

  getRules(repositoryId: string): Promise<RepoRules>;
  setRules(rules: RepoRules): Promise<void>;

  insertPullRequest(pr: PullRequest): Promise<void>;
  getPullRequest(repositoryId: string, number: number): Promise<PullRequest | null>;
  listPullRequests(
    repositoryId: string,
    state: PullRequest["state"] | "all",
  ): Promise<PullRequest[]>;
  updatePullRequestHead(id: string, headSha: string, baseSha: string): Promise<PullRequest | null>;
  updatePullRequestText(
    id: string,
    patch: { title?: string; body?: string },
  ): Promise<PullRequest | null>;
  closePullRequest(id: string, at: number): Promise<PullRequest | null>;
  markMerged(input: {
    id: string;
    mergeSha: string;
    expectedHeadSha: string;
    idempotencyKey?: string;
    at: number;
  }): Promise<PullRequest | null>;
  findMergedByIdempotency(repositoryId: string, key: string): Promise<PullRequest | null>;

  insertReview(review: Review): Promise<void>;
  listReviews(pullRequestId: string): Promise<Review[]>;
  insertComment(comment: Comment): Promise<void>;
  listComments(pullRequestId: string): Promise<Comment[]>;

  upsertCheck(run: CheckRun): Promise<CheckRun>;
  listChecks(repositoryId: string, headSha: string): Promise<CheckRun[]>;
  insertAnnotation(annotation: Annotation): Promise<void>;
  listAnnotations(checkRunId: string): Promise<Annotation[]>;

  insertToken(token: ApiToken): Promise<void>;
  findTokenByPrefix(prefix: string): Promise<ApiToken | null>;
  listTokens(userId: string): Promise<ApiToken[]>;
  touchToken(id: string, at: number): Promise<void>;
  revokeToken(id: string, userId: string, at: number): Promise<boolean>;

  insertWebhook(hook: Webhook): Promise<void>;
  listWebhooks(repositoryId: string): Promise<Webhook[]>;
  deleteWebhook(id: string, repositoryId: string): Promise<boolean>;
  insertWebhookDelivery(delivery: WebhookDelivery): Promise<void>;

  insertAudit(event: AuditEvent): Promise<void>;
  listAudit(repositoryId: string, limit: number): Promise<AuditEvent[]>;

  takeRate(
    key: string,
    now: number,
    windowMs: number,
    max: number,
  ): Promise<{ ok: boolean; remaining: number }>;
}
