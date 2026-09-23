import { hasScope, scopesForRole, type Scope } from "@forgit/auth/scopes";
import { hashToken, safeEqual, tokenPrefix } from "@forgit/auth/crypto";
import { assertRepoName, type GitClient } from "@forgit/git-client";
import { signBody } from "@forgit/auth/crypto";

import { assertWebhookUrl } from "./webhook.ts";

import type { ForgeStore } from "./store.ts";
import {
  ForgeError,
  type Actor,
  type CheckConclusion,
  type CheckStatus,
  type PullRequest,
  type RepoRole,
  type Repository,
  type ReviewState,
} from "./types.ts";

export type Services = ReturnType<typeof createServices>;

const REF_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;

export function createServices(
  store: ForgeStore,
  git: GitClient,
  origin: string,
  requestId: string | null = null,
) {
  const publicOrigin = origin.replace(/\/$/, "");

  async function level(
    actor: Actor | null,
    repo: Repository,
  ): Promise<"none" | "read" | "write" | "admin"> {
    if (actor?.repositoryIds && !actor.repositoryIds.includes(repo.id)) return "none";
    const [orgMember, repoMember] = actor
      ? await Promise.all([
          store.getOrgMember(repo.organizationId, actor.userId),
          store.getRepoMember(repo.id, actor.userId),
        ])
      : [null, null];
    let role: RepoRole | null = null;
    if (orgMember?.role === "owner" || orgMember?.role === "admin") role = "admin";
    else if (repoMember) role = repoMember.role;
    else if (repo.visibility === "public") role = "read";
    if (!role) return "none";
    if (!actor?.tokenScopes) {
      if (role === "admin") return "admin";
      if (role === "write") return "write";
      return "read";
    }
    const granted = scopesForRole(role).filter((scope) => hasScope(actor.tokenScopes ?? [], scope));
    if (hasScope(granted, "repo:admin")) return "admin";
    if (hasScope(granted, "repo:write")) return "write";
    if (hasScope(granted, "repo:read")) return "read";
    return "none";
  }

  function requireLevel(
    actual: "none" | "read" | "write" | "admin",
    needed: "read" | "write" | "admin",
  ) {
    const rank = { none: 0, read: 1, write: 2, admin: 3 };
    if (rank[actual] < rank[needed]) throw new ForgeError("Forbidden", 403, "forbidden");
  }

  async function requireRepo(
    actor: Actor | null,
    owner: string,
    name: string,
    needed: "read" | "write" | "admin",
  ) {
    assertRepoName(owner);
    assertRepoName(name);
    const org = await store.getOrganizationBySlug(owner);
    if (!org) throw new ForgeError("Repository not found", 404, "not_found");
    const repo = await store.getRepositoryByName(org.id, name);
    if (!repo) throw new ForgeError("Repository not found", 404, "not_found");
    const actual = await level(actor, repo);
    if (repo.archived && needed !== "read")
      throw new ForgeError("Repository is archived", 403, "archived");
    requireLevel(actual, needed);
    return { org, repo, actual };
  }

  async function audit(
    actor: Actor | null,
    action: string,
    repositoryId: string | null,
    target: string,
    metadata: Record<string, string | number | boolean | null> = {},
    eventRequestId: string | null = null,
  ) {
    await store.insertAudit({
      id: crypto.randomUUID(),
      actorId: actor?.userId ?? null,
      action,
      repositoryId,
      target,
      metadata,
      requestId: eventRequestId ?? requestId,
      createdAt: store.now(),
    });
  }

  async function deliver(repositoryId: string, event: string, payload: unknown) {
    const hooks = await store.listWebhooks(repositoryId);
    await Promise.all(
      hooks
        .filter((hook) => hook.active && (hook.events.includes("*") || hook.events.includes(event)))
        .map(async (hook) => {
          const body = JSON.stringify({ event, payload });
          const signature = await signBody(hook.secret, body);
          const deliveryId = crypto.randomUUID();
          let status: "delivered" | "failed" = "delivered";
          try {
            assertWebhookUrl(hook.url);
            const response = await fetch(hook.url, {
              method: "POST",
              redirect: "manual",
              headers: {
                "content-type": "application/json",
                "x-forgit-event": event,
                "x-forgit-delivery": deliveryId,
                "x-forgit-signature": signature,
              },
              body,
            });
            if (!response.ok) throw new Error(`Webhook responded ${response.status}`);
          } catch (error) {
            status = "failed";
            await audit(null, "webhook.delivery_failed", repositoryId, hook.id, {
              event,
              delivery: deliveryId,
              error: error instanceof Error ? error.message : "delivery failed",
            });
          }
          await store.insertWebhookDelivery({
            id: deliveryId,
            webhookId: hook.id,
            event,
            status,
            attempts: 1,
            createdAt: store.now(),
          });
        }),
    );
  }

  return {
    store,
    git,
    origin: publicOrigin,

    async actorFromAuthorization(header: string | null): Promise<Actor | null> {
      if (!header) return null;
      const token = parseAuthorization(header);
      if (!token) return null;
      const prefix = tokenPrefix(token);
      if (!prefix) return null;
      const row = await store.findTokenByPrefix(prefix);
      if (!row) return null;
      const now = store.now();
      if (row.revokedAt || (row.expiresAt !== null && row.expiresAt <= now)) return null;
      if (!safeEqual(row.hash, await hashToken(token))) return null;
      const [user] = await Promise.all([store.getUser(row.userId), store.touchToken(row.id, now)]);
      if (!user) return null;
      return {
        userId: user.id,
        login: user.login,
        tokenId: row.id,
        tokenScopes: row.scopes,
        repositoryIds: row.repositoryIds,
      };
    },

    async actorFromUser(userId: string): Promise<Actor> {
      const user = await store.getUser(userId);
      if (!user) throw new ForgeError("Unknown user", 401, "unauthorized");
      return { userId, login: user.login, tokenScopes: null, repositoryIds: null };
    },

    async listVisibleRepositories(actor: Actor) {
      return store.listRepositoriesForUser(actor.userId);
    },

    async createRepository(
      actor: Actor,
      input: {
        owner: string;
        name: string;
        description?: string;
        visibility?: "private" | "public";
        defaultBranch?: string;
      },
      requestId: string | null = null,
    ) {
      assertRepoName(input.owner);
      assertRepoName(input.name);
      const org = await store.getOrganizationBySlug(input.owner);
      if (!org) throw new ForgeError("Organization not found", 404, "not_found");
      const membership = await store.getOrgMember(org.id, actor.userId);
      if (!membership) throw new ForgeError("Forbidden", 403, "forbidden");
      if (actor.tokenScopes && !hasScope(actor.tokenScopes, "repo:admin")) {
        throw new ForgeError("Forbidden", 403, "forbidden");
      }
      const existing = await store.getRepositoryByName(org.id, input.name);
      if (existing) throw new ForgeError("Repository already exists", 409, "exists");
      const now = store.now();
      const id = crypto.randomUUID();
      const repo: Repository = {
        id,
        organizationId: org.id,
        name: input.name,
        description: input.description ?? "",
        defaultBranch: input.defaultBranch || "main",
        visibility: input.visibility ?? "private",
        archived: false,
        backingId: id,
        nextPrNumber: 0,
        createdAt: now,
        updatedAt: now,
      };
      await store.insertRepository(repo);
      await store.upsertRepoMember({ repositoryId: id, userId: actor.userId, role: "admin" });
      await store.setRules({
        repositoryId: id,
        requiredApprovals: 1,
        requiredChecks: [],
        dismissStaleReviews: true,
      });
      try {
        await git.createRepository(org.slug, repo.name);
        await git.setProtectedBranch(org.slug, repo.name, repo.defaultBranch);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Git store creation failed";
        try {
          await git.deleteRepository(org.slug, repo.name);
        } catch {
          // Storage may be down, or the repo may never have been created.
        }
        await store.deleteRepository(id);
        throw new ForgeError(message, 503, "git");
      }
      await audit(actor, "repo.create", id, `${org.slug}/${repo.name}`, {}, requestId);
      return { repo, owner: org.slug };
    },

    async archiveRepository(actor: Actor, owner: string, name: string) {
      const { repo, org } = await requireRepo(actor, owner, name, "admin");
      await store.updateRepository(repo.id, { archived: true });
      await audit(actor, "repo.archive", repo.id, `${org.slug}/${repo.name}`);
    },

    async destroyRepository(actor: Actor, owner: string, name: string) {
      const { repo, org } = await requireRepo(actor, owner, name, "admin");
      const target = `${org.slug}/${repo.name}`;
      try {
        await git.deleteRepository(org.slug, repo.name);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Git store delete failed";
        throw new ForgeError(message, 503, "git");
      }
      await store.deleteRepository(repo.id);
      await audit(actor, "repo.delete", null, target);
    },

    requireRepo,
    level,

    async openPullRequest(
      actor: Actor,
      owner: string,
      name: string,
      input: {
        title: string;
        body?: string;
        sourceRef: string;
        targetRef: string;
        idempotencyKey?: string;
      },
    ) {
      const { repo, org } = await requireRepo(actor, owner, name, "write");
      if (!hasPullScope(actor, "pull_request:write"))
        throw new ForgeError("Forbidden", 403, "forbidden");
      if (!REF_NAME.test(input.sourceRef) || !REF_NAME.test(input.targetRef)) {
        throw new ForgeError("Ref name is not allowed", 400, "ref");
      }
      if (input.idempotencyKey) {
        const prior = await store.findMergedByIdempotency(repo.id, input.idempotencyKey);
        if (prior) return prior;
      }
      const headSha = await git.resolve(org.slug, repo.name, input.sourceRef);
      const baseSha = await git.resolve(org.slug, repo.name, input.targetRef);
      if (!headSha || !baseSha)
        throw new ForgeError("Source or target ref was not found", 422, "ref");
      const number = await store.allocatePullNumber(repo.id);
      const now = store.now();
      const pr: PullRequest = {
        id: crypto.randomUUID(),
        repositoryId: repo.id,
        number,
        title: input.title.trim(),
        body: input.body ?? "",
        authorId: actor.userId,
        sourceRef: input.sourceRef,
        targetRef: input.targetRef,
        baseSha,
        headSha,
        state: "open",
        mergeSha: null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdAt: now,
        updatedAt: now,
        closedAt: null,
        mergedAt: null,
      };
      if (!pr.title) throw new ForgeError("Title is required", 400, "title");
      await store.insertPullRequest(pr);
      await audit(actor, "pull_request.open", repo.id, String(number), {
        head: headSha,
        base: baseSha,
      });
      await deliver(repo.id, "pull_request", { action: "opened", number });
      return pr;
    },

    async syncPullRequest(owner: string, name: string, number: number) {
      const org = await store.getOrganizationBySlug(owner);
      const repo = org ? await store.getRepositoryByName(org.id, name) : null;
      const pr = repo ? await store.getPullRequest(repo.id, number) : null;
      if (!org || !repo || !pr || pr.state !== "open") return pr;
      const headSha = await git.resolve(org.slug, repo.name, pr.sourceRef);
      const baseSha = await git.resolve(org.slug, repo.name, pr.targetRef);
      if (!headSha || !baseSha) return pr;
      if (headSha === pr.headSha && baseSha === pr.baseSha) return pr;
      return (await store.updatePullRequestHead(pr.id, headSha, baseSha)) ?? pr;
    },

    async reviewPullRequest(
      actor: Actor,
      owner: string,
      name: string,
      number: number,
      input: { state: ReviewState; body?: string },
    ) {
      const { repo } = await requireRepo(actor, owner, name, "write");
      if (!hasPullScope(actor, "review:write")) throw new ForgeError("Forbidden", 403, "forbidden");
      const pr = await this.syncPullRequest(owner, name, number);
      if (!pr || pr.state !== "open")
        throw new ForgeError("Pull request is not open", 409, "not_open");
      if (pr.authorId === actor.userId && input.state === "approved") {
        throw new ForgeError("Authors cannot approve their own pull request", 422, "self_approval");
      }
      const review = {
        id: crypto.randomUUID(),
        pullRequestId: pr.id,
        authorId: actor.userId,
        headSha: pr.headSha,
        state: input.state,
        body: input.body ?? "",
        createdAt: store.now(),
      };
      await store.insertReview(review);
      await audit(actor, "pull_request.review", repo.id, String(pr.number), {
        state: input.state,
        head: pr.headSha,
      });
      return { pr, review };
    },

    async commentOnPullRequest(
      actor: Actor,
      owner: string,
      name: string,
      number: number,
      input: { body: string; path: string; line?: number | null },
    ) {
      const { repo } = await requireRepo(actor, owner, name, "read");
      if (!hasPullScope(actor, "pull_request:write") && actor.tokenScopes) {
        throw new ForgeError("Forbidden", 403, "forbidden");
      }
      const pr = await store.getPullRequest(repo.id, number);
      if (!pr) throw new ForgeError("Pull request not found", 404, "not_found");
      if (!input.path || input.path.includes(".."))
        throw new ForgeError("Path is not allowed", 400, "path");
      const comment = {
        id: crypto.randomUUID(),
        pullRequestId: pr.id,
        authorId: actor.userId,
        path: input.path,
        line: input.line ?? null,
        body: input.body,
        commitSha: pr.headSha,
        createdAt: store.now(),
      };
      await store.insertComment(comment);
      await audit(actor, "pull_request.comment", repo.id, String(pr.number), { path: input.path });
      return comment;
    },

    async mergePullRequest(
      actor: Actor,
      owner: string,
      name: string,
      number: number,
      input: {
        expectedHeadSha?: string;
        message?: string;
        idempotencyKey?: string;
        method?: string;
      } = {},
    ) {
      const { repo, org } = await requireRepo(actor, owner, name, "write");
      if (!hasPullScope(actor, "pull_request:write"))
        throw new ForgeError("Forbidden", 403, "forbidden");
      if (input.method && input.method !== "squash") {
        throw new ForgeError("Only squash merges are supported", 422, "merge_method");
      }
      if (input.idempotencyKey) {
        const prior = await store.findMergedByIdempotency(repo.id, input.idempotencyKey);
        if (prior?.mergeSha) return { sha: prior.mergeSha, pr: prior };
      }
      const pr = await this.syncPullRequest(owner, name, number);
      if (!pr || pr.repositoryId !== repo.id)
        throw new ForgeError("Pull request not found", 404, "not_found");
      if (pr.state !== "open") throw new ForgeError("Pull request is not open", 409, "not_open");
      if (input.expectedHeadSha && input.expectedHeadSha !== pr.headSha) {
        throw new ForgeError("Head SHA moved", 409, "stale_head");
      }
      const rules = await store.getRules(repo.id);
      const reviews = await store.listReviews(pr.id);
      const approvals = reviews.filter(
        (review) =>
          review.state === "approved" &&
          (!rules.dismissStaleReviews || review.headSha === pr.headSha),
      );
      const uniqueApprovers = new Set(approvals.map((review) => review.authorId));
      uniqueApprovers.delete(pr.authorId);
      if (uniqueApprovers.size < rules.requiredApprovals) {
        throw new ForgeError("Required approvals are missing", 409, "reviews");
      }
      const changes = reviews.filter(
        (review) => review.state === "changes_requested" && review.headSha === pr.headSha,
      );
      if (changes.length > 0) throw new ForgeError("Changes have been requested", 409, "reviews");
      const checks = await store.listChecks(repo.id, pr.headSha);
      for (const checkName of rules.requiredChecks) {
        const run = checks.find((check) => check.name === checkName);
        if (!run || run.status !== "completed" || run.conclusion !== "success") {
          throw new ForgeError(`Required check ${checkName} has not passed`, 409, "checks");
        }
      }
      const author = await store.getUser(pr.authorId);
      const compared = await git.compare(org.slug, repo.name, pr.baseSha, pr.headSha);
      if (compared && !compared.mergeable) {
        throw new ForgeError("Pull request has conflicts", 409, "conflict");
      }
      const result = await git.squashMerge({
        owner: org.slug,
        repo: repo.name,
        baseRef: pr.targetRef,
        headRef: pr.sourceRef,
        expectedBaseSha: pr.baseSha,
        expectedHeadSha: pr.headSha,
        message: input.message?.trim() || `${pr.title} (#${pr.number})`,
        authorName: author?.name ?? actor.login,
        authorEmail: author?.email ?? "noreply@forgit.local",
      });
      const merged = await store.markMerged({
        id: pr.id,
        mergeSha: result.sha,
        expectedHeadSha: pr.headSha,
        idempotencyKey: input.idempotencyKey,
        at: store.now(),
      });
      if (!merged) throw new ForgeError("Pull request changed during merge", 409, "conflict");
      await audit(actor, "pull_request.merge", repo.id, String(pr.number), {
        sha: result.sha,
        head: pr.headSha,
      });
      await deliver(repo.id, "pull_request", {
        action: "merged",
        number: pr.number,
        sha: result.sha,
      });
      return { sha: result.sha, pr: merged };
    },

    async recordCheck(
      actor: Actor,
      owner: string,
      name: string,
      input: {
        name: string;
        headSha: string;
        status: CheckStatus;
        conclusion?: CheckConclusion | null;
        title?: string;
        summary?: string;
      },
    ) {
      const { repo } = await requireRepo(actor, owner, name, "write");
      if (actor.tokenScopes && !hasScope(actor.tokenScopes, "checks:write")) {
        throw new ForgeError("Forbidden", 403, "forbidden");
      }
      if (!/^[0-9a-f]{40}$/.test(input.headSha))
        throw new ForgeError("head SHA must be 40 hex characters", 400, "sha");
      const now = store.now();
      const run = await store.upsertCheck({
        id: crypto.randomUUID(),
        repositoryId: repo.id,
        name: input.name,
        headSha: input.headSha,
        status: input.status,
        conclusion: input.status === "completed" ? (input.conclusion ?? "neutral") : null,
        title: input.title ?? input.name,
        summary: input.summary ?? "",
        startedAt: now,
        completedAt: input.status === "completed" ? now : null,
      });
      await audit(actor, "check.record", repo.id, input.headSha, {
        name: input.name,
        status: input.status,
        conclusion: run.conclusion,
      });
      return run;
    },

    async createToken(
      actor: Actor,
      input: {
        name: string;
        scopes: Scope[];
        repositoryIds?: string[] | null;
        repositories?: string[];
        expiresAt?: number | null;
        kind?: "personal" | "machine";
      },
    ) {
      const { generateToken } = await import("@forgit/auth/crypto");
      const { parseScopes } = await import("@forgit/auth/scopes");
      if (input.kind === "machine" && input.expiresAt == null) {
        throw new ForgeError("Machine tokens must expire", 422, "expiry");
      }
      const minted = await generateToken();
      const scopes = parseScopes(input.scopes);
      let repositoryIds = input.repositoryIds ?? null;
      if (input.repositories && input.repositories.length > 0) {
        const ids: string[] = [];
        for (const spec of input.repositories) {
          const parts = spec.split("/");
          const owner = parts[0] ?? "";
          const name = parts[1] ?? "";
          if (parts.length !== 2 || !owner || !name) {
            throw new ForgeError("Repository must be owner/name", 422, "repo");
          }
          const loaded = await requireRepo(actor, owner, name, "read");
          ids.push(loaded.repo.id);
        }
        repositoryIds = ids;
      }
      const token = {
        id: crypto.randomUUID(),
        userId: actor.userId,
        name: input.name.trim() || "token",
        prefix: minted.prefix,
        hash: minted.hash,
        scopes,
        repositoryIds,
        kind: input.kind ?? "personal",
        expiresAt: input.expiresAt ?? null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: store.now(),
      };
      await store.insertToken(token);
      await audit(actor, "token.create", null, token.id, {
        prefix: token.prefix,
        kind: token.kind,
      });
      return { token, plaintext: minted.plaintext };
    },

    async revokeToken(actor: Actor, tokenId: string) {
      const ok = await store.revokeToken(tokenId, actor.userId, store.now());
      if (!ok) throw new ForgeError("Token not found", 404, "not_found");
      await audit(actor, "token.revoke", null, tokenId, {});
    },

    async createWebhook(
      actor: Actor,
      owner: string,
      name: string,
      input: { url: string; events?: string[]; secret?: string; active?: boolean },
    ) {
      const { repo } = await requireRepo(actor, owner, name, "admin");
      if (!hasPullScope(actor, "webhook:admin")) {
        throw new ForgeError("Forbidden", 403, "forbidden");
      }
      assertWebhookUrl(input.url);
      const events = (input.events ?? ["*"]).map((event) => event.trim()).filter(Boolean);
      const secret = input.secret?.trim() || `whsec_${crypto.randomUUID().replaceAll("-", "")}`;
      const hook = {
        id: crypto.randomUUID(),
        repositoryId: repo.id,
        url: input.url,
        secret,
        events: events.length > 0 ? events : ["*"],
        active: input.active !== false,
        createdAt: store.now(),
      };
      await store.insertWebhook(hook);
      await audit(actor, "webhook.create", repo.id, hook.id, { url: hook.url });
      return hook;
    },

    async deleteWebhook(actor: Actor, owner: string, name: string, hookId: string) {
      const { repo } = await requireRepo(actor, owner, name, "admin");
      if (!hasPullScope(actor, "webhook:admin")) {
        throw new ForgeError("Forbidden", 403, "forbidden");
      }
      const ok = await store.deleteWebhook(hookId, repo.id);
      if (!ok) throw new ForgeError("Webhook not found", 404, "not_found");
      await audit(actor, "webhook.delete", repo.id, hookId, {});
    },

    cloneUrl(owner: string, name: string) {
      return `${publicOrigin}/${owner}/${name}.git`;
    },
  };
}

function parseAuthorization(header: string): string | null {
  const bearer = header.match(/^(?:Bearer|token)\s+(\S+)$/i);
  if (bearer?.[1]) return bearer[1];
  const basic = header.match(/^Basic\s+(\S+)$/i);
  if (!basic?.[1]) return null;
  try {
    const decoded = atob(basic[1]);
    const separator = decoded.indexOf(":");
    if (separator === -1) return decoded;
    return decoded.slice(separator + 1) || decoded.slice(0, separator);
  } catch {
    return null;
  }
}

function hasPullScope(actor: Actor, scope: Scope): boolean {
  if (!actor.tokenScopes) return true;
  return hasScope(actor.tokenScopes, scope);
}
