import { takeRate } from "@forgit/auth/rate";

import type { ForgeStore } from "./store.ts";
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

type UserRow = User & { organizationIds: string[] };

export class MemoryStore implements ForgeStore {
  users = new Map<string, UserRow>();
  organizations = new Map<string, Organization>();
  orgMembers: OrgMember[] = [];
  repositories = new Map<string, Repository>();
  repoMembers: RepoMember[] = [];
  rules = new Map<string, RepoRules>();
  pulls: PullRequest[] = [];
  reviews: Review[] = [];
  comments: Comment[] = [];
  checks: CheckRun[] = [];
  annotations: Annotation[] = [];
  tokens: ApiToken[] = [];
  webhooks: Webhook[] = [];
  deliveries: WebhookDelivery[] = [];
  audit: AuditEvent[] = [];
  rates = new Map<string, { count: number; windowStart: number }>();
  clock = Date.now();

  now(): number {
    return this.clock;
  }

  async getUser(id: string) {
    const user = this.users.get(id);
    return user ? publicUser(user) : null;
  }

  async getUserByEmail(email: string) {
    const user = [...this.users.values()].find((row) => row.email === email);
    return user ? publicUser(user) : null;
  }

  async getUserByLogin(login: string) {
    const user = [...this.users.values()].find((row) => row.login === login);
    return user ? publicUser(user) : null;
  }

  async upsertLogin(userId: string, login: string, _createdAt: number) {
    const user = this.users.get(userId);
    if (!user) throw new Error("Unknown user");
    user.login = login;
  }

  async getOrganization(id: string) {
    return this.organizations.get(id) ?? null;
  }

  async getOrganizationBySlug(slug: string) {
    return [...this.organizations.values()].find((org) => org.slug === slug) ?? null;
  }

  async listOrganizationsForUser(userId: string) {
    const ids = new Set(
      this.orgMembers
        .filter((member) => member.userId === userId)
        .map((member) => member.organizationId),
    );
    return [...this.organizations.values()].filter((org) => ids.has(org.id));
  }

  async getOrgMember(organizationId: string, userId: string) {
    return (
      this.orgMembers.find(
        (member) => member.organizationId === organizationId && member.userId === userId,
      ) ?? null
    );
  }

  async listOrgMembers(organizationId: string) {
    return this.orgMembers
      .filter((member) => member.organizationId === organizationId)
      .flatMap((member) => {
        const user = this.users.get(member.userId);
        return user ? [{ ...member, email: user.email, name: user.name, login: user.login }] : [];
      });
  }

  async insertRepository(repo: Repository) {
    this.repositories.set(repo.id, { ...repo });
  }

  async getRepository(id: string) {
    const repo = this.repositories.get(id);
    return repo ? { ...repo } : null;
  }

  async getRepositoryByName(organizationId: string, name: string) {
    const repo = [...this.repositories.values()].find(
      (row) => row.organizationId === organizationId && row.name === name,
    );
    return repo ? { ...repo } : null;
  }

  async getRepoAccess(owner: string, name: string, userId: string | null) {
    const org = await this.getOrganizationBySlug(owner);
    if (!org) return null;
    const repo = await this.getRepositoryByName(org.id, name);
    if (!repo) return null;
    const [orgMember, repoMember] = userId
      ? await Promise.all([this.getOrgMember(org.id, userId), this.getRepoMember(repo.id, userId)])
      : [null, null];
    return { org, repo, orgMember, repoMember };
  }

  async listRepositoriesForOrg(organizationId: string) {
    return [...this.repositories.values()]
      .filter((repo) => repo.organizationId === organizationId)
      .map((repo) => ({ ...repo }));
  }

  async listRepositoriesForUser(userId: string) {
    const orgs = await this.listOrganizationsForUser(userId);
    const rows: Array<Repository & { owner: string }> = [];
    for (const org of orgs) {
      const member = await this.getOrgMember(org.id, userId);
      for (const repo of await this.listRepositoriesForOrg(org.id)) {
        const direct = await this.getRepoMember(repo.id, userId);
        if (member?.role === "owner" || member?.role === "admin" || direct) {
          rows.push({ ...repo, owner: org.slug });
        }
      }
    }
    return rows;
  }

  async deleteRepository(id: string) {
    const pullIds = new Set(
      this.pulls.filter((pull) => pull.repositoryId === id).map((pull) => pull.id),
    );
    const checkIds = new Set(
      this.checks.filter((check) => check.repositoryId === id).map((check) => check.id),
    );
    this.repositories.delete(id);
    this.repoMembers = this.repoMembers.filter((member) => member.repositoryId !== id);
    this.rules.delete(id);
    this.pulls = this.pulls.filter((pull) => pull.repositoryId !== id);
    this.reviews = this.reviews.filter((review) => !pullIds.has(review.pullRequestId));
    this.comments = this.comments.filter((comment) => !pullIds.has(comment.pullRequestId));
    this.checks = this.checks.filter((check) => check.repositoryId !== id);
    this.annotations = this.annotations.filter((note) => !checkIds.has(note.checkRunId));
    this.webhooks = this.webhooks.filter((hook) => hook.repositoryId !== id);
  }

  async updateRepository(
    id: string,
    patch: Partial<Pick<Repository, "description" | "archived" | "defaultBranch" | "visibility">>,
  ) {
    const repo = this.repositories.get(id);
    if (!repo) return;
    Object.assign(repo, patch, { updatedAt: this.now() });
  }

  async allocatePullNumber(repositoryId: string) {
    const repo = this.repositories.get(repositoryId);
    if (!repo) throw new Error("Unknown repository");
    repo.nextPrNumber += 1;
    return repo.nextPrNumber;
  }

  async upsertRepoMember(member: RepoMember) {
    const index = this.repoMembers.findIndex(
      (row) => row.repositoryId === member.repositoryId && row.userId === member.userId,
    );
    if (index === -1) this.repoMembers.push({ ...member });
    else this.repoMembers[index] = { ...member };
  }

  async getRepoMember(repositoryId: string, userId: string) {
    return (
      this.repoMembers.find((row) => row.repositoryId === repositoryId && row.userId === userId) ??
      null
    );
  }

  async listRepoMembers(repositoryId: string) {
    return this.repoMembers
      .filter((row) => row.repositoryId === repositoryId)
      .flatMap((row) => {
        const user = this.users.get(row.userId);
        return user ? [{ ...row, login: user.login, email: user.email }] : [];
      });
  }

  async deleteRepoMember(repositoryId: string, userId: string) {
    this.repoMembers = this.repoMembers.filter(
      (row) => !(row.repositoryId === repositoryId && row.userId === userId),
    );
  }

  async getRules(repositoryId: string) {
    return (
      this.rules.get(repositoryId) ?? {
        repositoryId,
        requiredApprovals: 0,
        requiredChecks: [],
        dismissStaleReviews: true,
      }
    );
  }

  async setRules(rules: RepoRules) {
    this.rules.set(rules.repositoryId, { ...rules, requiredChecks: [...rules.requiredChecks] });
  }

  async insertPullRequest(pr: PullRequest) {
    this.pulls.push({ ...pr });
  }

  async getPullRequest(repositoryId: string, number: number) {
    const pr = this.pulls.find((row) => row.repositoryId === repositoryId && row.number === number);
    return pr ? { ...pr } : null;
  }

  async listPullRequests(repositoryId: string, state: PullRequest["state"] | "all") {
    return this.pulls
      .filter(
        (row) => row.repositoryId === repositoryId && (state === "all" || row.state === state),
      )
      .map((row) => ({ ...row }))
      .sort((left, right) => right.number - left.number);
  }

  async updatePullRequestHead(id: string, headSha: string, baseSha: string) {
    const pr = this.pulls.find((row) => row.id === id && row.state === "open");
    if (!pr) return null;
    pr.headSha = headSha;
    pr.baseSha = baseSha;
    pr.updatedAt = this.now();
    return { ...pr };
  }

  async updatePullRequestText(id: string, patch: { title?: string; body?: string }) {
    const pr = this.pulls.find((row) => row.id === id);
    if (!pr) return null;
    if (patch.title !== undefined) pr.title = patch.title;
    if (patch.body !== undefined) pr.body = patch.body;
    pr.updatedAt = this.now();
    return { ...pr };
  }

  async closePullRequest(id: string, at: number) {
    const pr = this.pulls.find((row) => row.id === id && row.state === "open");
    if (!pr) return null;
    pr.state = "closed";
    pr.closedAt = at;
    pr.updatedAt = at;
    return { ...pr };
  }

  async markMerged(input: {
    id: string;
    mergeSha: string;
    expectedHeadSha: string;
    idempotencyKey?: string;
    at: number;
  }) {
    const pr = this.pulls.find(
      (row) => row.id === input.id && row.state === "open" && row.headSha === input.expectedHeadSha,
    );
    if (!pr) return null;
    pr.state = "merged";
    pr.mergeSha = input.mergeSha;
    pr.mergedAt = input.at;
    pr.updatedAt = input.at;
    if (input.idempotencyKey) pr.idempotencyKey = input.idempotencyKey;
    return { ...pr };
  }

  async findMergedByIdempotency(repositoryId: string, key: string) {
    const pr = this.pulls.find(
      (row) =>
        row.repositoryId === repositoryId && row.idempotencyKey === key && row.state === "merged",
    );
    return pr ? { ...pr } : null;
  }

  async insertReview(review: Review) {
    this.reviews.push({ ...review });
  }

  async listReviews(pullRequestId: string) {
    return this.reviews
      .filter((row) => row.pullRequestId === pullRequestId)
      .map((row) => ({ ...row }));
  }

  async insertComment(comment: Comment) {
    this.comments.push({ ...comment });
  }

  async listComments(pullRequestId: string) {
    return this.comments
      .filter((row) => row.pullRequestId === pullRequestId)
      .map((row) => ({ ...row }));
  }

  async upsertCheck(run: CheckRun) {
    const index = this.checks.findIndex(
      (row) =>
        row.repositoryId === run.repositoryId &&
        row.name === run.name &&
        row.headSha === run.headSha,
    );
    if (index === -1) this.checks.push({ ...run });
    else this.checks[index] = { ...run, id: this.checks[index]?.id ?? run.id };
    return {
      ...(this.checks.find(
        (row) =>
          row.repositoryId === run.repositoryId &&
          row.name === run.name &&
          row.headSha === run.headSha,
      ) as CheckRun),
    };
  }

  async listChecks(repositoryId: string, headSha: string) {
    return this.checks
      .filter((row) => row.repositoryId === repositoryId && row.headSha === headSha)
      .map((row) => ({ ...row }));
  }

  async insertAnnotation(annotation: Annotation) {
    this.annotations.push({ ...annotation });
  }

  async listAnnotations(checkRunId: string) {
    return this.annotations
      .filter((row) => row.checkRunId === checkRunId)
      .map((row) => ({ ...row }));
  }

  async insertToken(token: ApiToken) {
    this.tokens.push({
      ...token,
      scopes: [...token.scopes],
      repositoryIds: token.repositoryIds ? [...token.repositoryIds] : null,
    });
  }

  async findTokenByPrefix(prefix: string) {
    const token = this.tokens.find((row) => row.prefix === prefix);
    return token ? { ...token, scopes: [...token.scopes] } : null;
  }

  async listTokens(userId: string) {
    return this.tokens
      .filter((row) => row.userId === userId)
      .map((row) => ({ ...row, scopes: [...row.scopes] }));
  }

  async touchToken(id: string, at: number) {
    const token = this.tokens.find((row) => row.id === id);
    if (token) token.lastUsedAt = at;
  }

  async revokeToken(id: string, userId: string, at: number) {
    const token = this.tokens.find(
      (row) => row.id === id && row.userId === userId && !row.revokedAt,
    );
    if (!token) return false;
    token.revokedAt = at;
    return true;
  }

  async insertWebhook(hook: Webhook) {
    this.webhooks.push({ ...hook, events: [...hook.events] });
  }

  async listWebhooks(repositoryId: string) {
    return this.webhooks
      .filter((row) => row.repositoryId === repositoryId)
      .map((row) => ({ ...row, events: [...row.events] }));
  }

  async deleteWebhook(id: string, repositoryId: string) {
    const before = this.webhooks.length;
    this.webhooks = this.webhooks.filter(
      (row) => !(row.id === id && row.repositoryId === repositoryId),
    );
    return this.webhooks.length !== before;
  }

  async insertWebhookDelivery(delivery: WebhookDelivery) {
    this.deliveries.push({ ...delivery });
  }

  async insertAudit(event: AuditEvent) {
    this.audit.push({ ...event, metadata: { ...event.metadata } });
  }

  async listAudit(repositoryId: string, limit: number) {
    return this.audit
      .filter((row) => row.repositoryId === repositoryId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }

  async takeRate(key: string, now: number, windowMs: number, max: number) {
    const { decision, bucket } = takeRate(this.rates.get(key) ?? null, now, windowMs, max);
    this.rates.set(key, bucket);
    return decision;
  }

  seedUser(user: User, organization?: Organization & { role?: OrgMember["role"] }) {
    this.users.set(user.id, { ...user, organizationIds: [] });
    if (organization) {
      this.organizations.set(organization.id, {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      });
      this.orgMembers.push({
        organizationId: organization.id,
        userId: user.id,
        role: organization.role ?? "owner",
      });
    }
    return user;
  }
}

function publicUser(user: UserRow): User {
  return { id: user.id, name: user.name, email: user.email, login: user.login };
}
