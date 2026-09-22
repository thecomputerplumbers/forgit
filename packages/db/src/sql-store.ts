import { takeRate } from "@forgit/auth/rate";
import type { Scope } from "@forgit/auth/scopes";
import type { ForgeStore } from "@forgit/domain";
import type {
  Annotation,
  ApiToken,
  AuditEvent,
  CheckConclusion,
  CheckRun,
  CheckStatus,
  Comment,
  Organization,
  OrgRole,
  PullRequest,
  PullState,
  RepoRole,
  RepoRules,
  Repository,
  Review,
  ReviewState,
  User,
  Webhook,
} from "@forgit/domain";

export type Sql = {
  all<T>(query: string, params?: unknown[]): Promise<T[]>;
  run(query: string, params?: unknown[]): Promise<{ changes: number }>;
};

type D1Like = {
  prepare(query: string): {
    bind(...params: unknown[]): {
      all(): Promise<{ results?: unknown[] }>;
      run(): Promise<{ meta?: { changes?: number } }>;
    };
  };
};

export function d1Sql(database: D1Like): Sql {
  return {
    async all(query, params = []) {
      const result = await database
        .prepare(query)
        .bind(...params)
        .all();
      return (result.results ?? []) as never;
    },
    async run(query, params = []) {
      const result = await database
        .prepare(query)
        .bind(...params)
        .run();
      return { changes: result.meta?.changes ?? 0 };
    },
  };
}

type RepoRow = {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  default_branch: string;
  visibility: "private" | "public";
  archived: number;
  backing_id: string;
  next_pr_number: number;
  created_at: number;
  updated_at: number;
};

function repo(row: RepoRow): Repository {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    defaultBranch: row.default_branch,
    visibility: row.visibility,
    archived: row.archived === 1,
    backingId: row.backing_id,
    nextPrNumber: row.next_pr_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type PrRow = {
  id: string;
  repository_id: string;
  number: number;
  title: string;
  body: string;
  author_id: string;
  source_ref: string;
  target_ref: string;
  base_sha: string;
  head_sha: string;
  state: PullState;
  merge_sha: string | null;
  idempotency_key: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  merged_at: number | null;
};

function pr(row: PrRow): PullRequest {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    number: row.number,
    title: row.title,
    body: row.body,
    authorId: row.author_id,
    sourceRef: row.source_ref,
    targetRef: row.target_ref,
    baseSha: row.base_sha,
    headSha: row.head_sha,
    state: row.state,
    mergeSha: row.merge_sha,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    mergedAt: row.merged_at,
  };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  return JSON.parse(value) as T;
}

export function createSqlStore(sql: Sql): ForgeStore {
  return {
    now: () => Date.now(),

    async getUser(id) {
      const rows = await sql.all<User & { login: string | null }>(
        `SELECT u.id, u.name, u.email, p.login FROM user u LEFT JOIN user_profile p ON p.user_id = u.id WHERE u.id = ?`,
        [id],
      );
      const row = rows[0];
      return row ? { ...row, login: row.login ?? row.email } : null;
    },

    async getUserByEmail(email) {
      const rows = await sql.all<User & { login: string | null }>(
        `SELECT u.id, u.name, u.email, p.login FROM user u LEFT JOIN user_profile p ON p.user_id = u.id WHERE u.email = ?`,
        [email],
      );
      const row = rows[0];
      return row ? { ...row, login: row.login ?? row.email } : null;
    },

    async getUserByLogin(login) {
      const rows = await sql.all<User>(
        `SELECT u.id, u.name, u.email, p.login FROM user u JOIN user_profile p ON p.user_id = u.id WHERE p.login = ?`,
        [login],
      );
      return rows[0] ?? null;
    },

    async upsertLogin(userId, login, createdAt) {
      await sql.run(
        `INSERT INTO user_profile (user_id, login, created_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET login = excluded.login`,
        [userId, login, createdAt],
      );
    },

    async getOrganization(id) {
      const rows = await sql.all<Organization>(
        `SELECT id, name, slug FROM organization WHERE id = ?`,
        [id],
      );
      return rows[0] ?? null;
    },

    async getOrganizationBySlug(slug) {
      const rows = await sql.all<Organization>(
        `SELECT id, name, slug FROM organization WHERE slug = ?`,
        [slug],
      );
      return rows[0] ?? null;
    },

    async listOrganizationsForUser(userId) {
      return sql.all<Organization>(
        `SELECT o.id, o.name, o.slug FROM organization o JOIN member m ON m.organization_id = o.id WHERE m.user_id = ? ORDER BY o.slug`,
        [userId],
      );
    },

    async getOrgMember(organizationId, userId) {
      const rows = await sql.all<{ organization_id: string; user_id: string; role: OrgRole }>(
        `SELECT organization_id, user_id, role FROM member WHERE organization_id = ? AND user_id = ?`,
        [organizationId, userId],
      );
      const row = rows[0];
      return row
        ? { organizationId: row.organization_id, userId: row.user_id, role: row.role }
        : null;
    },

    async listOrgMembers(organizationId) {
      const rows = await sql.all<{
        organization_id: string;
        user_id: string;
        role: OrgRole;
        email: string;
        name: string;
        login: string | null;
      }>(
        `SELECT m.organization_id, m.user_id, m.role, u.email, u.name, p.login
         FROM member m JOIN user u ON u.id = m.user_id LEFT JOIN user_profile p ON p.user_id = u.id
         WHERE m.organization_id = ?`,
        [organizationId],
      );
      return rows.map((row) => ({
        organizationId: row.organization_id,
        userId: row.user_id,
        role: row.role,
        email: row.email,
        name: row.name,
        login: row.login ?? row.email,
      }));
    },

    async insertRepository(repository) {
      await sql.run(
        `INSERT INTO repositories (id, organization_id, name, description, default_branch, visibility, archived, backing_id, next_pr_number, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          repository.id,
          repository.organizationId,
          repository.name,
          repository.description,
          repository.defaultBranch,
          repository.visibility,
          repository.archived ? 1 : 0,
          repository.backingId,
          repository.nextPrNumber,
          repository.createdAt,
          repository.updatedAt,
        ],
      );
    },

    async getRepository(id) {
      const rows = await sql.all<RepoRow>(`SELECT * FROM repositories WHERE id = ?`, [id]);
      return rows[0] ? repo(rows[0]) : null;
    },

    async deleteRepository(id) {
      await sql.run(
        `DELETE FROM pull_request_comments WHERE pull_request_id IN (SELECT id FROM pull_requests WHERE repository_id = ?)`,
        [id],
      );
      await sql.run(
        `DELETE FROM pull_request_reviews WHERE pull_request_id IN (SELECT id FROM pull_requests WHERE repository_id = ?)`,
        [id],
      );
      await sql.run(`DELETE FROM pull_requests WHERE repository_id = ?`, [id]);
      await sql.run(
        `DELETE FROM check_annotations WHERE check_run_id IN (SELECT id FROM check_runs WHERE repository_id = ?)`,
        [id],
      );
      await sql.run(`DELETE FROM check_runs WHERE repository_id = ?`, [id]);
      await sql.run(`DELETE FROM checks WHERE repository_id = ?`, [id]);
      await sql.run(`DELETE FROM webhooks WHERE repository_id = ?`, [id]);
      await sql.run(`DELETE FROM repository_members WHERE repository_id = ?`, [id]);
      await sql.run(`DELETE FROM repository_rules WHERE repository_id = ?`, [id]);
      await sql.run(`DELETE FROM repositories WHERE id = ?`, [id]);
    },

    async getRepositoryByName(organizationId, name) {
      const rows = await sql.all<RepoRow>(
        `SELECT * FROM repositories WHERE organization_id = ? AND name = ?`,
        [organizationId, name],
      );
      return rows[0] ? repo(rows[0]) : null;
    },

    async listRepositoriesForOrg(organizationId) {
      const rows = await sql.all<RepoRow>(
        `SELECT * FROM repositories WHERE organization_id = ? ORDER BY name`,
        [organizationId],
      );
      return rows.map(repo);
    },

    async listRepositoriesForUser(userId) {
      const rows = await sql.all<RepoRow & { owner: string }>(
        `SELECT DISTINCT r.*, o.slug AS owner
         FROM repositories r
         JOIN organization o ON o.id = r.organization_id
         JOIN member m ON m.organization_id = o.id AND m.user_id = ?
         LEFT JOIN repository_members rm ON rm.repository_id = r.id AND rm.user_id = ?
         WHERE m.role IN ('owner', 'admin') OR rm.user_id IS NOT NULL
         ORDER BY o.slug, r.name`,
        [userId, userId],
      );
      return rows.map((row) => ({ ...repo(row), owner: row.owner }));
    },

    async updateRepository(id, patch) {
      const current = await this.getRepository(id);
      if (!current) return;
      const next = { ...current, ...patch, updatedAt: Date.now() };
      await sql.run(
        `UPDATE repositories SET description = ?, archived = ?, default_branch = ?, visibility = ?, updated_at = ? WHERE id = ?`,
        [
          next.description,
          next.archived ? 1 : 0,
          next.defaultBranch,
          next.visibility,
          next.updatedAt,
          id,
        ],
      );
    },

    async allocatePullNumber(repositoryId) {
      const rows = await sql.all<{ next_pr_number: number }>(
        `UPDATE repositories SET next_pr_number = next_pr_number + 1 WHERE id = ? RETURNING next_pr_number`,
        [repositoryId],
      );
      const number = rows[0]?.next_pr_number;
      if (!number) throw new Error("Unknown repository");
      return number;
    },

    async upsertRepoMember(member) {
      await sql.run(
        `INSERT INTO repository_members (repository_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(repository_id, user_id) DO UPDATE SET role = excluded.role`,
        [member.repositoryId, member.userId, member.role, Date.now()],
      );
    },

    async getRepoMember(repositoryId, userId) {
      const rows = await sql.all<{ repository_id: string; user_id: string; role: RepoRole }>(
        `SELECT repository_id, user_id, role FROM repository_members WHERE repository_id = ? AND user_id = ?`,
        [repositoryId, userId],
      );
      const row = rows[0];
      return row ? { repositoryId: row.repository_id, userId: row.user_id, role: row.role } : null;
    },

    async listRepoMembers(repositoryId) {
      const rows = await sql.all<{
        repository_id: string;
        user_id: string;
        role: RepoRole;
        login: string | null;
        email: string;
      }>(
        `SELECT rm.repository_id, rm.user_id, rm.role, u.email, p.login
         FROM repository_members rm JOIN user u ON u.id = rm.user_id LEFT JOIN user_profile p ON p.user_id = u.id
         WHERE rm.repository_id = ?`,
        [repositoryId],
      );
      return rows.map((row) => ({
        repositoryId: row.repository_id,
        userId: row.user_id,
        role: row.role,
        login: row.login ?? row.email,
        email: row.email,
      }));
    },

    async deleteRepoMember(repositoryId, userId) {
      await sql.run(`DELETE FROM repository_members WHERE repository_id = ? AND user_id = ?`, [
        repositoryId,
        userId,
      ]);
    },

    async getRules(repositoryId) {
      const rows = await sql.all<{
        repository_id: string;
        required_approvals: number;
        required_checks: string;
        dismiss_stale_reviews: number;
      }>(`SELECT * FROM repository_rules WHERE repository_id = ?`, [repositoryId]);
      const row = rows[0];
      if (!row)
        return {
          repositoryId,
          requiredApprovals: 0,
          requiredChecks: [],
          dismissStaleReviews: true,
        };
      return {
        repositoryId,
        requiredApprovals: row.required_approvals,
        requiredChecks: parseJson<string[]>(row.required_checks, []),
        dismissStaleReviews: row.dismiss_stale_reviews === 1,
      };
    },

    async setRules(rules: RepoRules) {
      await sql.run(
        `INSERT INTO repository_rules (repository_id, required_approvals, required_checks, dismiss_stale_reviews)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(repository_id) DO UPDATE SET
           required_approvals = excluded.required_approvals,
           required_checks = excluded.required_checks,
           dismiss_stale_reviews = excluded.dismiss_stale_reviews`,
        [
          rules.repositoryId,
          rules.requiredApprovals,
          JSON.stringify(rules.requiredChecks),
          rules.dismissStaleReviews ? 1 : 0,
        ],
      );
    },

    async insertPullRequest(pull) {
      await sql.run(
        `INSERT INTO pull_requests (
           id, repository_id, number, title, body, author_id, source_ref, target_ref, base_sha, head_sha,
           state, merge_sha, idempotency_key, created_at, updated_at, closed_at, merged_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pull.id,
          pull.repositoryId,
          pull.number,
          pull.title,
          pull.body,
          pull.authorId,
          pull.sourceRef,
          pull.targetRef,
          pull.baseSha,
          pull.headSha,
          pull.state,
          pull.mergeSha,
          pull.idempotencyKey,
          pull.createdAt,
          pull.updatedAt,
          pull.closedAt,
          pull.mergedAt,
        ],
      );
    },

    async getPullRequest(repositoryId, number) {
      const rows = await sql.all<PrRow>(
        `SELECT * FROM pull_requests WHERE repository_id = ? AND number = ?`,
        [repositoryId, number],
      );
      return rows[0] ? pr(rows[0]) : null;
    },

    async listPullRequests(repositoryId, state) {
      const rows =
        state === "all"
          ? await sql.all<PrRow>(
              `SELECT * FROM pull_requests WHERE repository_id = ? ORDER BY number DESC`,
              [repositoryId],
            )
          : await sql.all<PrRow>(
              `SELECT * FROM pull_requests WHERE repository_id = ? AND state = ? ORDER BY number DESC`,
              [repositoryId, state],
            );
      return rows.map(pr);
    },

    async updatePullRequestHead(id, headSha, baseSha) {
      const rows = await sql.all<PrRow>(
        `UPDATE pull_requests SET head_sha = ?, base_sha = ?, updated_at = ? WHERE id = ? AND state = 'open' RETURNING *`,
        [headSha, baseSha, Date.now(), id],
      );
      return rows[0] ? pr(rows[0]) : null;
    },

    async updatePullRequestText(id, patch) {
      const current = await sql.all<PrRow>(`SELECT * FROM pull_requests WHERE id = ?`, [id]);
      const row = current[0];
      if (!row) return null;
      const title = patch.title ?? row.title;
      const body = patch.body ?? row.body;
      const rows = await sql.all<PrRow>(
        `UPDATE pull_requests SET title = ?, body = ?, updated_at = ? WHERE id = ? RETURNING *`,
        [title, body, Date.now(), id],
      );
      return rows[0] ? pr(rows[0]) : null;
    },

    async closePullRequest(id, at) {
      const rows = await sql.all<PrRow>(
        `UPDATE pull_requests SET state = 'closed', closed_at = ?, updated_at = ? WHERE id = ? AND state = 'open' RETURNING *`,
        [at, at, id],
      );
      return rows[0] ? pr(rows[0]) : null;
    },

    async markMerged(input) {
      const rows = await sql.all<PrRow>(
        `UPDATE pull_requests
         SET state = 'merged', merge_sha = ?, merged_at = ?, updated_at = ?, idempotency_key = COALESCE(?, idempotency_key)
         WHERE id = ? AND state = 'open' AND head_sha = ?
         RETURNING *`,
        [
          input.mergeSha,
          input.at,
          input.at,
          input.idempotencyKey ?? null,
          input.id,
          input.expectedHeadSha,
        ],
      );
      return rows[0] ? pr(rows[0]) : null;
    },

    async findMergedByIdempotency(repositoryId, key) {
      const rows = await sql.all<PrRow>(
        `SELECT * FROM pull_requests WHERE repository_id = ? AND idempotency_key = ? AND state = 'merged'`,
        [repositoryId, key],
      );
      return rows[0] ? pr(rows[0]) : null;
    },

    async insertReview(review: Review) {
      await sql.run(
        `INSERT INTO pull_request_reviews (id, pull_request_id, author_id, head_sha, state, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          review.id,
          review.pullRequestId,
          review.authorId,
          review.headSha,
          review.state,
          review.body,
          review.createdAt,
        ],
      );
    },

    async listReviews(pullRequestId) {
      const rows = await sql.all<{
        id: string;
        pull_request_id: string;
        author_id: string;
        head_sha: string;
        state: ReviewState;
        body: string;
        created_at: number;
      }>(`SELECT * FROM pull_request_reviews WHERE pull_request_id = ? ORDER BY created_at`, [
        pullRequestId,
      ]);
      return rows.map((row) => ({
        id: row.id,
        pullRequestId: row.pull_request_id,
        authorId: row.author_id,
        headSha: row.head_sha,
        state: row.state,
        body: row.body,
        createdAt: row.created_at,
      }));
    },

    async insertComment(comment: Comment) {
      await sql.run(
        `INSERT INTO pull_request_comments (id, pull_request_id, author_id, path, line, body, commit_sha, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          comment.id,
          comment.pullRequestId,
          comment.authorId,
          comment.path,
          comment.line,
          comment.body,
          comment.commitSha,
          comment.createdAt,
        ],
      );
    },

    async listComments(pullRequestId) {
      const rows = await sql.all<{
        id: string;
        pull_request_id: string;
        author_id: string;
        path: string;
        line: number | null;
        body: string;
        commit_sha: string;
        created_at: number;
      }>(`SELECT * FROM pull_request_comments WHERE pull_request_id = ? ORDER BY created_at`, [
        pullRequestId,
      ]);
      return rows.map((row) => ({
        id: row.id,
        pullRequestId: row.pull_request_id,
        authorId: row.author_id,
        path: row.path,
        line: row.line,
        body: row.body,
        commitSha: row.commit_sha,
        createdAt: row.created_at,
      }));
    },

    async upsertCheck(run) {
      await sql.run(
        `INSERT INTO check_runs (id, repository_id, name, head_sha, status, conclusion, title, summary, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repository_id, name, head_sha) DO UPDATE SET
           status = excluded.status,
           conclusion = excluded.conclusion,
           title = excluded.title,
           summary = excluded.summary,
           completed_at = excluded.completed_at`,
        [
          run.id,
          run.repositoryId,
          run.name,
          run.headSha,
          run.status,
          run.conclusion,
          run.title,
          run.summary,
          run.startedAt,
          run.completedAt,
        ],
      );
      const rows = await sql.all<
        CheckRun & {
          repository_id: string;
          head_sha: string;
          started_at: number;
          completed_at: number | null;
        }
      >(`SELECT * FROM check_runs WHERE repository_id = ? AND name = ? AND head_sha = ?`, [
        run.repositoryId,
        run.name,
        run.headSha,
      ]);
      const row = rows[0];
      if (!row) throw new Error("Check was not stored");
      return {
        id: row.id,
        repositoryId: row.repository_id,
        name: row.name,
        headSha: row.head_sha,
        status: row.status as CheckStatus,
        conclusion: row.conclusion as CheckConclusion | null,
        title: row.title,
        summary: row.summary,
        startedAt: row.started_at,
        completedAt: row.completed_at,
      };
    },

    async listChecks(repositoryId, headSha) {
      const rows = await sql.all<{
        id: string;
        repository_id: string;
        name: string;
        head_sha: string;
        status: CheckStatus;
        conclusion: CheckConclusion | null;
        title: string;
        summary: string;
        started_at: number;
        completed_at: number | null;
      }>(`SELECT * FROM check_runs WHERE repository_id = ? AND head_sha = ?`, [
        repositoryId,
        headSha,
      ]);
      return rows.map((row) => ({
        id: row.id,
        repositoryId: row.repository_id,
        name: row.name,
        headSha: row.head_sha,
        status: row.status,
        conclusion: row.conclusion,
        title: row.title,
        summary: row.summary,
        startedAt: row.started_at,
        completedAt: row.completed_at,
      }));
    },

    async insertAnnotation(annotation: Annotation) {
      await sql.run(
        `INSERT INTO check_annotations (id, check_run_id, path, start_line, end_line, message, level) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          annotation.id,
          annotation.checkRunId,
          annotation.path,
          annotation.startLine,
          annotation.endLine,
          annotation.message,
          annotation.level,
        ],
      );
    },

    async listAnnotations(checkRunId) {
      const rows = await sql.all<{
        id: string;
        check_run_id: string;
        path: string;
        start_line: number | null;
        end_line: number | null;
        message: string;
        level: Annotation["level"];
      }>(`SELECT * FROM check_annotations WHERE check_run_id = ?`, [checkRunId]);
      return rows.map((row) => ({
        id: row.id,
        checkRunId: row.check_run_id,
        path: row.path,
        startLine: row.start_line,
        endLine: row.end_line,
        message: row.message,
        level: row.level,
      }));
    },

    async insertToken(token: ApiToken) {
      await sql.run(
        `INSERT INTO api_tokens (id, user_id, name, prefix, token_hash, scopes, repository_ids, kind, expires_at, last_used_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          token.id,
          token.userId,
          token.name,
          token.prefix,
          token.hash,
          JSON.stringify(token.scopes),
          token.repositoryIds ? JSON.stringify(token.repositoryIds) : null,
          token.kind,
          token.expiresAt,
          token.lastUsedAt,
          token.revokedAt,
          token.createdAt,
        ],
      );
    },

    async findTokenByPrefix(prefix) {
      const rows = await sql.all<{
        id: string;
        user_id: string;
        name: string;
        prefix: string;
        token_hash: string;
        scopes: string;
        repository_ids: string | null;
        kind: "personal" | "machine";
        expires_at: number | null;
        last_used_at: number | null;
        revoked_at: number | null;
        created_at: number;
      }>(`SELECT * FROM api_tokens WHERE prefix = ?`, [prefix]);
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        prefix: row.prefix,
        hash: row.token_hash,
        scopes: parseJson<Scope[]>(row.scopes, []),
        repositoryIds: row.repository_ids ? parseJson<string[]>(row.repository_ids, []) : null,
        kind: row.kind,
        expiresAt: row.expires_at,
        lastUsedAt: row.last_used_at,
        revokedAt: row.revoked_at,
        createdAt: row.created_at,
      };
    },

    async listTokens(userId) {
      const rows = await sql.all<{ id: string }>(
        `SELECT id, prefix FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`,
        [userId],
      );
      const tokens: ApiToken[] = [];
      for (const row of rows) {
        const full = await sql.all<{ prefix: string }>(
          `SELECT prefix FROM api_tokens WHERE id = ?`,
          [row.id],
        );
        const token = full[0] ? await this.findTokenByPrefix(full[0].prefix) : null;
        if (token) tokens.push(token);
      }
      return tokens;
    },

    async touchToken(id, at) {
      await sql.run(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`, [at, id]);
    },

    async revokeToken(id, userId, at) {
      const result = await sql.run(
        `UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
        [at, id, userId],
      );
      return result.changes > 0;
    },

    async insertWebhook(hook: Webhook) {
      await sql.run(
        `INSERT INTO webhooks (id, repository_id, url, secret, events, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          hook.id,
          hook.repositoryId,
          hook.url,
          hook.secret,
          JSON.stringify(hook.events),
          hook.active ? 1 : 0,
          hook.createdAt,
        ],
      );
    },

    async listWebhooks(repositoryId) {
      const rows = await sql.all<{
        id: string;
        repository_id: string;
        url: string;
        secret: string;
        events: string;
        active: number;
        created_at: number;
      }>(`SELECT * FROM webhooks WHERE repository_id = ?`, [repositoryId]);
      return rows.map((row) => ({
        id: row.id,
        repositoryId: row.repository_id,
        url: row.url,
        secret: row.secret,
        events: parseJson<string[]>(row.events, []),
        active: row.active === 1,
        createdAt: row.created_at,
      }));
    },

    async deleteWebhook(id, repositoryId) {
      const result = await sql.run(`DELETE FROM webhooks WHERE id = ? AND repository_id = ?`, [
        id,
        repositoryId,
      ]);
      return result.changes > 0;
    },

    async insertAudit(event: AuditEvent) {
      await sql.run(
        `INSERT INTO audit_events (id, actor_id, action, repository_id, target, metadata, request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.id,
          event.actorId,
          event.action,
          event.repositoryId,
          event.target,
          JSON.stringify(event.metadata),
          event.requestId,
          event.createdAt,
        ],
      );
    },

    async listAudit(repositoryId, limit) {
      const rows = await sql.all<{
        id: string;
        actor_id: string | null;
        action: string;
        repository_id: string | null;
        target: string;
        metadata: string;
        request_id: string | null;
        created_at: number;
      }>(`SELECT * FROM audit_events WHERE repository_id = ? ORDER BY created_at DESC LIMIT ?`, [
        repositoryId,
        limit,
      ]);
      return rows.map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        action: row.action,
        repositoryId: row.repository_id,
        target: row.target,
        metadata: parseJson(row.metadata, {}),
        requestId: row.request_id,
        createdAt: row.created_at,
      }));
    },

    async takeRate(key, now, windowMs, max) {
      const rows = await sql.all<{ count: number; window_start: number }>(
        `SELECT count, window_start FROM forge_rate WHERE key = ?`,
        [key],
      );
      const { decision, bucket } = takeRate(
        rows[0] ? { count: rows[0].count, windowStart: rows[0].window_start } : null,
        now,
        windowMs,
        max,
      );
      await sql.run(
        `INSERT INTO forge_rate (key, count, window_start) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET count = excluded.count, window_start = excluded.window_start`,
        [key, bucket.count, bucket.windowStart],
      );
      return decision;
    },
  };
}
