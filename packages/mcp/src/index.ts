import type { Services } from "@forgit/domain";
import { ForgeError, type Actor } from "@forgit/domain";
import { pullNodeId, repoNodeId } from "@forgit/github-compat";

import { publicAction, type ActionsService } from "@forgit/actions";

type ActionsExtension = {
  service: ActionsService;
  readLog: (key: string) => Promise<string | null>;
  changed: (operation: string, runId?: string) => Promise<void>;
};
const ACTION_TOOLS: Tool[] = [
  ["list_action_runs", "list", "List repository workflow runs."],
  ["get_action_run", "get", "Read run, jobs, steps, logs metadata, and agent diagnosis."],
  ["run_workflow", "run", "Dispatch a workflow at a ref; requires workflow:run."],
  ["rerun_workflow", "rerun", "Re-run a completed workflow at its original exact SHA."],
  ["cancel_action_run", "cancel", "Cancel an active workflow run."],
  ["get_action_log", "log", "Read a redacted step log (last 32000 characters)."],
].map(([name, operation, description]) => ({
  name: name!,
  description: description!,
  inputSchema: {
    type: "object",
    properties: {
      owner: { type: "string" },
      repo: { type: "string" },
      runId: { type: "string" },
      workflow: { type: "string" },
      ref: { type: "string" },
      jobId: { type: "string" },
      stepId: { type: "string" },
      operation: { const: operation },
    },
    required: ["owner", "repo"],
  },
}));

type Tool = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export const MCP_TOOLS: Tool[] = [
  {
    name: "get_me",
    description: "Return the authenticated user.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_file_contents",
    description: "Read a file or directory from a repository.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        path: { type: "string" },
        ref: { type: "string" },
      },
      required: ["owner", "repo", "path"],
    },
  },
  {
    name: "create_or_update_file",
    description: "Commit a file on a branch. Cannot update a protected default branch.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        path: { type: "string" },
        content: { type: "string" },
        message: { type: "string" },
        branch: { type: "string" },
      },
      required: ["owner", "repo", "path", "content", "message", "branch"],
    },
  },
  {
    name: "list_branches",
    description: "List branches.",
    inputSchema: {
      type: "object",
      properties: { owner: { type: "string" }, repo: { type: "string" } },
      required: ["owner", "repo"],
    },
  },
  {
    name: "create_branch",
    description: "Create a branch from a ref.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        branch: { type: "string" },
        from: { type: "string" },
      },
      required: ["owner", "repo", "branch", "from"],
    },
  },
  {
    name: "list_pull_requests",
    description: "List pull requests.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        state: { type: "string" },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "pull_request_read",
    description: "Read one pull request, including reviews and checks for its head SHA.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        pullNumber: { type: "number" },
      },
      required: ["owner", "repo", "pullNumber"],
    },
  },
  {
    name: "create_pull_request",
    description: "Open a pull request.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        head: { type: "string" },
        base: { type: "string" },
      },
      required: ["owner", "repo", "title", "head", "base"],
    },
  },
  {
    name: "update_pull_request",
    description: "Update a pull request title, body, or close it.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        pullNumber: { type: "number" },
        title: { type: "string" },
        body: { type: "string" },
        state: { type: "string" },
      },
      required: ["owner", "repo", "pullNumber"],
    },
  },
  {
    name: "merge_pull_request",
    description: "Squash-merge a pull request when approvals and required checks pass.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        pullNumber: { type: "number" },
        expectedHeadSha: { type: "string" },
      },
      required: ["owner", "repo", "pullNumber"],
    },
  },
  {
    name: "pull_request_review_write",
    description: "Submit a review. event is APPROVE, REQUEST_CHANGES, or COMMENT.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        pullNumber: { type: "number" },
        event: { type: "string" },
        body: { type: "string" },
      },
      required: ["owner", "repo", "pullNumber", "event"],
    },
  },
];

type Rpc = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
};

export async function handleMcp(
  request: Request,
  services: Services,
  actor: Actor | null,
  actions?: ActionsExtension,
): Promise<Response> {
  if (request.method === "GET") {
    return jsonRpc(
      { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Streamable HTTP uses POST" } },
      405,
    );
  }
  let body: Rpc;
  try {
    body = (await request.json()) as Rpc;
  } catch {
    return jsonRpc(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      400,
    );
  }
  const id = body.id ?? null;
  if (body.method === "initialize") {
    return jsonRpc({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "forgit", version: "0.1.0" },
      },
    });
  }
  if (body.method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }
  if (body.method === "tools/list") {
    return jsonRpc({
      jsonrpc: "2.0",
      id,
      result: { tools: [...MCP_TOOLS, ...(actions ? ACTION_TOOLS : [])] },
    });
  }
  if (body.method !== "tools/call") {
    return jsonRpc({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  }
  if (!actor) {
    return toolError(id, "Authentication required");
  }
  const params = body.params ?? {};
  const name = String(params.name ?? "");
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  try {
    const actionTool = actions && ACTION_TOOLS.find((t) => t.name === name);
    const result = actionTool
      ? await callActionTool(
          actions!,
          String((actionTool.inputSchema.properties.operation as { const: string }).const),
          args,
          actor,
        )
      : await callTool(name, args, services, actor);
    return jsonRpc({
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
        isError: false,
      },
    });
  } catch (error) {
    const message =
      error instanceof ForgeError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Tool failed";
    return toolError(id, message);
  }
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  services: Services,
  actor: Actor,
) {
  const owner = String(args.owner ?? "");
  const repo = String(args.repo ?? "");
  switch (name) {
    case "get_me": {
      const user = await services.store.getUser(actor.userId);
      return {
        login: actor.login,
        id: actor.userId,
        name: user?.name ?? actor.login,
        email: user?.email ?? null,
      };
    }
    case "get_file_contents": {
      await services.requireRepo(actor, owner, repo, "read");
      const ref = String(args.ref ?? "HEAD");
      const path = String(args.path ?? "");
      const blob = await services.git.blob(owner, repo, ref, path);
      if (blob) return { type: "file", path: blob.path, sha: blob.sha, content: blob.contents };
      const tree = await services.git.tree(owner, repo, ref, path);
      if (!tree) throw new ForgeError("Path not found", 404, "not_found");
      return { type: "dir", path, entries: tree.entries };
    }
    case "create_or_update_file": {
      await services.requireRepo(actor, owner, repo, "write");
      const user = await services.store.getUser(actor.userId);
      const written = await services.git.writeFile({
        owner,
        repo,
        branch: String(args.branch),
        path: String(args.path),
        contents: String(args.content),
        message: String(args.message),
        authorName: user?.name ?? actor.login,
        authorEmail: user?.email ?? "noreply@forgit.local",
      });
      return { commitSha: written.commitSha, path: args.path, branch: args.branch };
    }
    case "list_branches": {
      await services.requireRepo(actor, owner, repo, "read");
      return { branches: await services.git.branches(owner, repo) };
    }
    case "create_branch": {
      await services.requireRepo(actor, owner, repo, "write");
      const created = await services.git.createBranch({
        owner,
        repo,
        branch: String(args.branch),
        fromRef: String(args.from),
      });
      return { name: args.branch, sha: created.sha };
    }
    case "list_pull_requests": {
      const { repo: row } = await services.requireRepo(actor, owner, repo, "read");
      const state = (args.state === "closed" || args.state === "all" ? args.state : "open") as
        | "open"
        | "closed"
        | "all";
      const pulls = await services.store.listPullRequests(row.id, state);
      return {
        pullRequests: pulls.map((pr) => ({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          head: pr.headSha,
          id: pullNodeId(owner, repo, pr.number),
        })),
      };
    }
    case "pull_request_read": {
      const { repo: row } = await services.requireRepo(actor, owner, repo, "read");
      const pr = await services.syncPullRequest(owner, repo, Number(args.pullNumber));
      if (!pr) throw new ForgeError("Pull request not found", 404, "not_found");
      const reviews = await services.store.listReviews(pr.id);
      const checks = await services.store.listChecks(row.id, pr.headSha);
      return {
        id: pullNodeId(owner, repo, pr.number),
        repositoryId: repoNodeId(owner, repo),
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.state,
        headRef: pr.sourceRef,
        baseRef: pr.targetRef,
        headSha: pr.headSha,
        baseSha: pr.baseSha,
        reviews,
        checks,
      };
    }
    case "create_pull_request": {
      const pr = await services.openPullRequest(actor, owner, repo, {
        title: String(args.title),
        body: typeof args.body === "string" ? args.body : "",
        sourceRef: String(args.head),
        targetRef: String(args.base),
      });
      return {
        id: pullNodeId(owner, repo, pr.number),
        number: pr.number,
        url: `${services.origin}/${owner}/${repo}/pull/${pr.number}`,
      };
    }
    case "update_pull_request": {
      const { repo: row } = await services.requireRepo(actor, owner, repo, "write");
      const existing = await services.store.getPullRequest(row.id, Number(args.pullNumber));
      if (!existing) throw new ForgeError("Pull request not found", 404, "not_found");
      if (args.state === "closed") {
        const closed = await services.closePullRequest(actor, owner, repo, existing.number);
        return { number: closed.number, state: closed.state };
      }
      const updated = await services.store.updatePullRequestText(existing.id, {
        title: typeof args.title === "string" ? args.title : undefined,
        body: typeof args.body === "string" ? args.body : undefined,
      });
      return {
        number: updated?.number,
        title: updated?.title,
        body: updated?.body,
        state: updated?.state,
      };
    }
    case "merge_pull_request": {
      const result = await services.mergePullRequest(actor, owner, repo, Number(args.pullNumber), {
        expectedHeadSha:
          typeof args.expectedHeadSha === "string" ? args.expectedHeadSha : undefined,
        method: "squash",
      });
      return { sha: result.sha, merged: true, number: result.pr.number };
    }
    case "pull_request_review_write": {
      const event = String(args.event);
      const state =
        event === "APPROVE"
          ? "approved"
          : event === "REQUEST_CHANGES"
            ? "changes_requested"
            : "commented";
      const result = await services.reviewPullRequest(actor, owner, repo, Number(args.pullNumber), {
        state,
        body: typeof args.body === "string" ? args.body : "",
      });
      return { id: result.review.id, state: result.review.state, headSha: result.review.headSha };
    }
    default:
      throw new ForgeError(`Unknown tool ${name}`, 404, "tool");
  }
}

function toolError(id: number | string | null, message: string) {
  return jsonRpc({
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: message }], isError: true },
  });
}

function jsonRpc(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function callActionTool(
  extension: ActionsExtension,
  operation: string,
  args: Record<string, unknown>,
  actor: Actor,
) {
  const owner = String(args.owner ?? ""),
    repo = String(args.repo ?? "");
  if (operation === "log") {
    const run = await extension.service.get(actor, owner, repo, String(args.runId ?? ""));
    const step = run.jobs.find((j) => j.id === args.jobId)?.steps.find((s) => s.id === args.stepId);
    const text = step?.logKey ? await extension.readLog(step.logKey) : null;
    return { log: text?.slice(-32000) ?? null, truncated: (text?.length ?? 0) > 32000 };
  }
  const result = await publicAction(extension.service, actor, owner, repo, operation, args);
  if (["run", "rerun", "cancel"].includes(operation))
    await extension.changed(operation, String(args.runId ?? ""));
  return result;
}
