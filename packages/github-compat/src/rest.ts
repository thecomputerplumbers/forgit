import type { Services } from "@forgit/domain";
import {
  assertWebhookUrl,
  ForgeError,
  type Actor,
  type PullRequest,
  type Repository,
} from "@forgit/domain";

type Ctx = { services: Services; actor: Actor | null; origin: string };

function githubScopes(actor: Actor | null): string {
  const scopes = actor?.tokenScopes;
  if (!scopes) return "repo, read:org, read:user";
  const names: string[] = [];
  if (scopes.some((scope) => scope.startsWith("repo:"))) names.push("repo");
  if (scopes.includes("user:read")) names.push("read:org", "read:user");
  return names.join(", ");
}

function json(body: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function failure(error: unknown): Response {
  if (error instanceof ForgeError) {
    return json(
      { message: error.message, documentation_url: "https://docs.forgit.local" },
      error.status,
    );
  }
  const message = error instanceof Error ? error.message : "Internal error";
  const status =
    typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
  return json({ message }, Number.isFinite(status) ? status : 500);
}

function user(login: string, id = login) {
  return { login, id, type: "User" };
}

function repoBody(
  ctx: Ctx,
  owner: string,
  repo: Repository,
  permissions: { admin: boolean; push: boolean; pull: boolean },
) {
  const fullName = `${owner}/${repo.name}`;
  return {
    id: repo.id,
    node_id: repoNodeId(owner, repo.name),
    name: repo.name,
    full_name: fullName,
    private: repo.visibility === "private",
    description: repo.description,
    default_branch: repo.defaultBranch,
    archived: repo.archived,
    visibility: repo.visibility,
    html_url: `${ctx.origin}/${fullName}`,
    clone_url: ctx.services.cloneUrl(owner, repo.name),
    ssh_url: "",
    git_url: ctx.services.cloneUrl(owner, repo.name),
    owner: { login: owner, id: repo.organizationId, type: "Organization" },
    permissions,
    created_at: new Date(repo.createdAt).toISOString(),
    updated_at: new Date(repo.updatedAt).toISOString(),
  };
}

function prBody(ctx: Ctx, owner: string, name: string, pr: PullRequest, authorLogin: string) {
  const fullName = `${owner}/${name}`;
  return {
    id: pr.id,
    node_id: pullNodeId(owner, name, pr.number),
    number: pr.number,
    title: pr.title,
    body: pr.body,
    state: pr.state === "merged" ? "closed" : pr.state,
    merged: pr.state === "merged",
    draft: false,
    html_url: `${ctx.origin}/${fullName}/pull/${pr.number}`,
    url: `${ctx.origin}/api/v3/repos/${fullName}/pulls/${pr.number}`,
    user: user(authorLogin),
    head: {
      ref: pr.sourceRef,
      sha: pr.headSha,
      label: `${owner}:${pr.sourceRef}`,
      repo: { full_name: fullName, name },
    },
    base: {
      ref: pr.targetRef,
      sha: pr.baseSha,
      label: `${owner}:${pr.targetRef}`,
      repo: { full_name: fullName, name },
    },
    merge_commit_sha: pr.mergeSha,
    created_at: new Date(pr.createdAt).toISOString(),
    updated_at: new Date(pr.updatedAt).toISOString(),
    merged_at: pr.mergedAt ? new Date(pr.mergedAt).toISOString() : null,
    closed_at: pr.closedAt ? new Date(pr.closedAt).toISOString() : null,
  };
}

async function authorLogin(ctx: Ctx, userId: string) {
  return (await ctx.services.store.getUser(userId))?.login ?? "unknown";
}

export async function handleGithubRest(request: Request, ctx: Ctx): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/v3" && !url.pathname.startsWith("/api/v3/")) return null;
  const path = url.pathname === "/api/v3" ? "/" : url.pathname.slice("/api/v3".length) || "/";
  try {
    const response = await route(request.method, path, url, request, ctx);
    return response ?? json({ message: "Not Found" }, 404);
  } catch (error) {
    return failure(error);
  }
}

async function requireActor(ctx: Ctx): Promise<Actor> {
  if (!ctx.actor) throw new ForgeError("Requires authentication", 401, "unauthorized");
  return ctx.actor;
}

async function route(
  method: string,
  path: string,
  url: URL,
  request: Request,
  ctx: Ctx,
): Promise<Response | null> {
  if (method === "GET" && (path === "/" || path === "")) {
    return json(
      {
        current_user_url: `${ctx.origin}/api/v3/user`,
        repository_url: `${ctx.origin}/api/v3/repos/{owner}/{repo}`,
      },
      200,
      { "X-OAuth-Scopes": githubScopes(ctx.actor) },
    );
  }

  if (method === "GET" && path === "/user") {
    const actor = await requireActor(ctx);
    const row = await ctx.services.store.getUser(actor.userId);
    if (!row) throw new ForgeError("Requires authentication", 401, "unauthorized");
    return json({ login: row.login, id: row.id, name: row.name, email: row.email, type: "User" });
  }

  if (method === "GET" && path === "/user/repos") {
    const actor = await requireActor(ctx);
    const repos = await ctx.services.listVisibleRepositories(actor);
    return json(
      repos.map((repo) =>
        repoBody(ctx, repo.owner, repo, { admin: false, push: true, pull: true }),
      ),
    );
  }

  const repoMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)(.*)$/);
  if (repoMatch) {
    const owner = decodeURIComponent(repoMatch[1] ?? "");
    const name = decodeURIComponent(repoMatch[2] ?? "");
    const rest = repoMatch[3] ?? "";
    return repoRoute(method, owner, name, rest, url, request, ctx);
  }

  const orgRepos = path.match(/^\/orgs\/([^/]+)\/repos$/);
  if (orgRepos && method === "POST") {
    const actor = await requireActor(ctx);
    const body = (await request.json()) as {
      name?: string;
      description?: string;
      private?: boolean;
    };
    if (!body.name) throw new ForgeError("name is required", 422, "name");
    const created = await ctx.services.createRepository(actor, {
      owner: decodeURIComponent(orgRepos[1] ?? ""),
      name: body.name,
      description: body.description,
      visibility: body.private === false ? "public" : "private",
    });
    return json(
      repoBody(ctx, created.owner, created.repo, { admin: true, push: true, pull: true }),
      201,
    );
  }

  if (method === "POST" && path === "/user/repos") {
    const actor = await requireActor(ctx);
    const orgs = await ctx.services.store.listOrganizationsForUser(actor.userId);
    const org = orgs[0];
    if (!org)
      throw new ForgeError("Create an organization before creating a repository", 422, "org");
    const body = (await request.json()) as {
      name?: string;
      description?: string;
      private?: boolean;
    };
    if (!body.name) throw new ForgeError("name is required", 422, "name");
    const created = await ctx.services.createRepository(actor, {
      owner: org.slug,
      name: body.name,
      description: body.description,
      visibility: body.private === false ? "public" : "private",
    });
    return json(
      repoBody(ctx, created.owner, created.repo, { admin: true, push: true, pull: true }),
      201,
    );
  }

  return null;
}

async function repoRoute(
  method: string,
  owner: string,
  name: string,
  rest: string,
  url: URL,
  request: Request,
  ctx: Ctx,
): Promise<Response | null> {
  if (rest === "" && method === "GET") {
    const { repo, actual } = await ctx.services.requireRepo(ctx.actor, owner, name, "read");
    return json(
      repoBody(ctx, owner, repo, {
        admin: actual === "admin",
        push: actual === "write" || actual === "admin",
        pull: true,
      }),
    );
  }

  if (rest === "/branches" && method === "GET") {
    const { repo } = await ctx.services.requireRepo(ctx.actor, owner, name, "read");
    const branches = await ctx.services.git.branches(owner, name);
    return json(
      branches.map((branch) => ({
        name: branch.name,
        commit: { sha: branch.sha },
        protected: branch.name === repo.defaultBranch,
      })),
    );
  }

  if (rest === "/commits" && method === "GET") {
    const { repo } = await ctx.services.requireRepo(ctx.actor, owner, name, "read");
    const ref = url.searchParams.get("sha") || repo.defaultBranch;
    const page = await ctx.services.git.commits(owner, name, ref, 0, 30);
    if (!page) return json({ message: "Not Found" }, 404);
    return json(
      page.commits.map((commit) => ({
        sha: commit.sha,
        html_url: `${ctx.origin}/${owner}/${name}/commit/${commit.sha}`,
        commit: {
          message: [commit.subject, commit.body].filter(Boolean).join("\n\n"),
          author: { name: commit.author, email: commit.authorEmail, date: commit.authorDate },
        },
      })),
    );
  }

  const contents = rest.match(/^\/contents\/(.+)$/);
  if (contents && method === "GET") {
    await ctx.services.requireRepo(ctx.actor, owner, name, "read");
    const path = decodeURIComponent(contents[1] ?? "");
    const ref = url.searchParams.get("ref") || "HEAD";
    const blob = await ctx.services.git.blob(owner, name, ref, path);
    if (blob) {
      return json({
        type: "file",
        name: blob.name,
        path: blob.path,
        sha: blob.sha,
        size: blob.size,
        encoding: blob.contents ? "utf-8" : null,
        content: blob.contents,
        html_url: `${ctx.origin}/${owner}/${name}/blob/${ref}/${path}`,
      });
    }
    const tree = await ctx.services.git.tree(owner, name, ref, path);
    if (!tree) return json({ message: "Not Found" }, 404);
    return json(
      tree.entries.map((entry) => ({
        type: entry.type === "tree" ? "dir" : "file",
        name: entry.name,
        path: path ? `${path}/${entry.name}` : entry.name,
        sha: entry.sha,
        size: entry.size,
      })),
    );
  }

  if (rest === "/pulls" && method === "GET") {
    const { repo } = await ctx.services.requireRepo(ctx.actor, owner, name, "read");
    const state = (url.searchParams.get("state") ?? "open") as "open" | "closed" | "all";
    const pulls = await ctx.services.store.listPullRequests(
      repo.id,
      state === "closed" ? "all" : state,
    );
    const filtered = state === "closed" ? pulls.filter((pr) => pr.state !== "open") : pulls;
    const bodies = [];
    for (const pr of filtered)
      bodies.push(prBody(ctx, owner, name, pr, await authorLogin(ctx, pr.authorId)));
    return json(bodies);
  }

  if (rest === "/pulls" && method === "POST") {
    const actor = await requireActor(ctx);
    const body = (await request.json()) as {
      title?: string;
      body?: string;
      head?: string;
      base?: string;
    };
    if (!body.title || !body.head || !body.base)
      throw new ForgeError("title, head, and base are required", 422, "pull");
    const pr = await ctx.services.openPullRequest(actor, owner, name, {
      title: body.title,
      body: body.body,
      sourceRef: body.head,
      targetRef: body.base,
    });
    return json(prBody(ctx, owner, name, pr, actor.login), 201);
  }

  const pull = rest.match(/^\/pulls\/(\d+)$/);
  if (pull && method === "GET") {
    await ctx.services.requireRepo(ctx.actor, owner, name, "read");
    const number = Number(pull[1]);
    const pr = await ctx.services.syncPullRequest(owner, name, number);
    if (!pr) return json({ message: "Not Found" }, 404);
    return json(prBody(ctx, owner, name, pr, await authorLogin(ctx, pr.authorId)));
  }

  if (pull && method === "PATCH") {
    const actor = await requireActor(ctx);
    const { repo } = await ctx.services.requireRepo(actor, owner, name, "write");
    const existing = await ctx.services.store.getPullRequest(repo.id, Number(pull[1]));
    if (!existing) return json({ message: "Not Found" }, 404);
    const body = (await request.json()) as { title?: string; body?: string; state?: string };
    if (body.state === "closed" && existing.state === "open") {
      const closed = await ctx.services.store.closePullRequest(
        existing.id,
        ctx.services.store.now(),
      );
      if (!closed) throw new ForgeError("Pull request is not open", 409, "not_open");
      return json(prBody(ctx, owner, name, closed, await authorLogin(ctx, closed.authorId)));
    }
    const updated = await ctx.services.store.updatePullRequestText(existing.id, {
      title: body.title,
      body: body.body,
    });
    if (!updated) return json({ message: "Not Found" }, 404);
    return json(prBody(ctx, owner, name, updated, await authorLogin(ctx, updated.authorId)));
  }

  const files = rest.match(/^\/pulls\/(\d+)\/files$/);
  if (files && method === "GET") {
    const { repo } = await ctx.services.requireRepo(ctx.actor, owner, name, "read");
    const pr = await ctx.services.store.getPullRequest(repo.id, Number(files[1]));
    if (!pr) return json({ message: "Not Found" }, 404);
    const compare = await ctx.services.git.compare(owner, name, pr.baseSha, pr.headSha);
    return json(
      (compare?.files ?? []).map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.additions + file.deletions,
        patch: file.patch,
      })),
    );
  }

  const reviews = rest.match(/^\/pulls\/(\d+)\/reviews$/);
  if (reviews && method === "POST") {
    const actor = await requireActor(ctx);
    const body = (await request.json()) as { body?: string; event?: string };
    const state =
      body.event === "APPROVE"
        ? "approved"
        : body.event === "REQUEST_CHANGES"
          ? "changes_requested"
          : "commented";
    const result = await ctx.services.reviewPullRequest(actor, owner, name, Number(reviews[1]), {
      state,
      body: body.body,
    });
    return json(
      {
        id: result.review.id,
        state: body.event ?? "COMMENT",
        body: result.review.body,
        commit_id: result.review.headSha,
        user: user(actor.login),
      },
      200,
    );
  }

  const merge = rest.match(/^\/pulls\/(\d+)\/merge$/);
  if (merge && method === "PUT") {
    const actor = await requireActor(ctx);
    const body = (await request.json().catch(() => ({}))) as {
      merge_method?: string;
      sha?: string;
      commit_title?: string;
    };
    const result = await ctx.services.mergePullRequest(actor, owner, name, Number(merge[1]), {
      method: body.merge_method,
      expectedHeadSha: body.sha,
      message: body.commit_title,
    });
    return json({ sha: result.sha, merged: true, message: "Pull request successfully merged" });
  }

  const checks = rest.match(/^\/commits\/([^/]+)\/check-runs$/);
  if (checks && method === "POST") {
    const actor = await requireActor(ctx);
    const body = (await request.json()) as {
      name?: string;
      status?: "queued" | "in_progress" | "completed";
      conclusion?: "success" | "failure" | "cancelled" | "skipped" | "neutral";
      output?: { title?: string; summary?: string };
    };
    if (!body.name) throw new ForgeError("name is required", 422, "check");
    const run = await ctx.services.recordCheck(actor, owner, name, {
      name: body.name,
      headSha: decodeURIComponent(checks[1] ?? ""),
      status: body.status ?? "completed",
      conclusion: body.conclusion,
      title: body.output?.title,
      summary: body.output?.summary,
    });
    return json(
      {
        id: run.id,
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
        head_sha: run.headSha,
      },
      201,
    );
  }

  if (rest === "/hooks" && method === "POST") {
    const actor = await requireActor(ctx);
    const { repo } = await ctx.services.requireRepo(actor, owner, name, "admin");
    const body = (await request.json()) as {
      config?: { url?: string; secret?: string };
      events?: string[];
      active?: boolean;
    };
    if (!body.config?.url) throw new ForgeError("config.url is required", 422, "webhook");
    assertWebhookUrl(body.config.url);
    const hook = {
      id: crypto.randomUUID(),
      repositoryId: repo.id,
      url: body.config.url,
      secret: body.config.secret || `whsec_${crypto.randomUUID().replaceAll("-", "")}`,
      events: body.events ?? ["*"],
      active: body.active !== false,
      createdAt: ctx.services.store.now(),
    };
    await ctx.services.store.insertWebhook(hook);
    return json(
      { id: hook.id, active: hook.active, events: hook.events, config: { url: hook.url } },
      201,
    );
  }

  return null;
}

export async function handleGithubGraphql(request: Request, ctx: Ctx): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/graphql" || request.method !== "POST") return null;
  try {
    const body = (await request.json()) as {
      query?: string;
      variables?: Record<string, unknown>;
      operationName?: string;
    };
    const query = body.query ?? "";
    const variables = body.variables ?? {};
    if (!ctx.actor) return json({ errors: [{ message: "Requires authentication" }] }, 401);
    if (query.includes("createPullRequest")) {
      const input = (variables.input ?? variables) as {
        repositoryId?: string;
        title?: string;
        body?: string;
        headRefName?: string;
        baseRefName?: string;
      };
      const parsed = parseRepoNode(String(input.repositoryId ?? ""));
      if (!parsed || !input.title || !input.headRefName || !input.baseRefName) {
        return json({ errors: [{ message: "createPullRequest input is incomplete" }] }, 422);
      }
      const pr = await ctx.services.openPullRequest(ctx.actor, parsed.owner, parsed.name, {
        title: input.title,
        body: typeof input.body === "string" ? input.body : "",
        sourceRef: input.headRefName,
        targetRef: input.baseRefName,
      });
      return json({
        data: {
          createPullRequest: {
            pullRequest: graphqlPr(ctx, parsed.owner, parsed.name, pr, ctx.actor.login),
          },
        },
      });
    }
    if (query.includes("mergePullRequest")) {
      const input = (variables.input ?? variables) as {
        pullRequestId?: string;
        mergeMethod?: string;
        commitHeadline?: string;
        expectedHeadOid?: string;
      };
      const parsed = parsePrNode(String(input.pullRequestId ?? ""));
      if (!parsed) return json({ errors: [{ message: "Unknown pull request" }] }, 404);
      const result = await ctx.services.mergePullRequest(
        ctx.actor,
        parsed.owner,
        parsed.name,
        parsed.number,
        {
          method: (input.mergeMethod ?? "SQUASH").toLowerCase(),
          message: input.commitHeadline,
          expectedHeadSha: input.expectedHeadOid,
        },
      );
      return json({
        data: {
          mergePullRequest: {
            pullRequest: graphqlPr(ctx, parsed.owner, parsed.name, result.pr, ctx.actor.login),
          },
        },
      });
    }
    if (query.includes("viewer") && !query.includes("mutation")) {
      const row = await ctx.services.store.getUser(ctx.actor.userId);
      return json({
        data: {
          viewer: {
            login: row?.login ?? ctx.actor.login,
            id: row?.id ?? ctx.actor.userId,
          },
        },
      });
    }
    if (query.includes("addPullRequestReview")) {
      const input = (variables.input ?? variables) as {
        pullRequestId?: string;
        event?: string;
        body?: string;
      };
      const parsed = parsePrNode(String(input.pullRequestId ?? ""));
      if (!parsed) return json({ errors: [{ message: "Unknown pull request" }] }, 404);
      const event = String(input.event ?? "COMMENT");
      const state =
        event === "APPROVE"
          ? "approved"
          : event === "REQUEST_CHANGES"
            ? "changes_requested"
            : "commented";
      const result = await ctx.services.reviewPullRequest(
        ctx.actor,
        parsed.owner,
        parsed.name,
        parsed.number,
        { state, body: input.body },
      );
      return json({
        data: {
          addPullRequestReview: {
            pullRequestReview: { id: result.review.id, state: event, body: result.review.body },
          },
        },
      });
    }
    return json({ data: {}, errors: [{ message: "Unsupported GraphQL operation" }] }, 400);
  } catch (error) {
    return failure(error);
  }
}

function graphqlPr(ctx: Ctx, owner: string, name: string, pr: PullRequest, login: string) {
  return {
    id: pullNodeId(owner, name, pr.number),
    number: pr.number,
    title: pr.title,
    body: pr.body,
    url: `${ctx.origin}/${owner}/${name}/pull/${pr.number}`,
    state: pr.state === "open" ? "OPEN" : pr.state === "merged" ? "MERGED" : "CLOSED",
    headRefName: pr.sourceRef,
    baseRefName: pr.targetRef,
    headRefOid: pr.headSha,
    author: { login },
  };
}

export function repoNodeId(owner: string, name: string) {
  return `forgit:repo:${owner}/${name}`;
}

export function pullNodeId(owner: string, name: string, number: number) {
  return `forgit:pr:${owner}/${name}/${number}`;
}

function parseRepoNode(id: string): { owner: string; name: string } | null {
  const match = id.match(/^forgit:repo:([^/]+)\/([^/]+)$/);
  if (!match?.[1] || !match[2]) return null;
  return { owner: match[1], name: match[2] };
}

function parsePrNode(id: string): { owner: string; name: string; number: number } | null {
  const match = id.match(/^forgit:pr:([^/]+)\/([^/]+)\/(\d+)$/);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { owner: match[1], name: match[2], number: Number(match[3]) };
}
