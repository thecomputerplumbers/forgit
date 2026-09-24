import { env } from "cloudflare:workers";
import {
  publicAction,
  internalAction,
  verifyEvent,
  actionHttpOperation,
  PublicArgumentsSchema,
} from "@forgit/actions";
import { safeEqual } from "@forgit/auth/crypto";
import { ForgeError, type Actor } from "@forgit/domain";
import { dispatchActions, getActions } from "./actions.ts";

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });
export async function actionsHttp(
  request: Request,
  actor: Actor | null,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url),
    path = url.pathname;
  const internal = path === "/api/actions/internal",
    events = path === "/api/actions/events";
  const match = path.match(/^\/api\/v3\/repos\/([^/]+)\/([^/]+)\/actions(?:\/(.*))?$/);
  if (!internal && !events && !match) return null;
  try {
    const actions = getActions();
    if (internal || events) {
      if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
      if (
        internal &&
        (!env.ACTIONS_INTERNAL_TOKEN ||
          !safeEqual(
            request.headers.get("authorization") ?? "",
            `Bearer ${env.ACTIONS_INTERNAL_TOKEN}`,
          ))
      )
        return json({ message: "Unauthorized" }, 401);
      const body = await boundedBody(request, internal ? 1024 * 1024 : 4 * 1024 * 1024);
      if (events) {
        await actions.receive(
          await verifyEvent(
            body,
            request.headers.get("x-walgit-signature"),
            env.ACTIONS_EVENT_SECRET,
          ),
        );
        ctx.waitUntil(dispatchActions());
        return json({ accepted: true }, 202);
      }
      return json(await internalAction(actions, JSON.parse(body)));
    }
    if (!actor) return json({ message: "Authentication required" }, 401);
    const owner = decodeURIComponent(match![1]!),
      repo = decodeURIComponent(match![2]!);
    const parts = (match![3] ?? "runs").split("/");
    if (request.method === "GET" && parts[0] === "runs" && parts[1] && parts[2] === "logs") {
      const run = await actions.get(actor, owner, repo, parts[1]);
      const job = run.jobs.find((j) => j.id === url.searchParams.get("job"));
      const step = job?.steps.find((s) => s.id === url.searchParams.get("step"));
      if (!step?.logKey || !env.ACTIONS_BUCKET) return json({ message: "Log not available" }, 404);
      const object = await env.ACTIONS_BUCKET.get(step.logKey);
      return object
        ? new Response(object.body, {
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          })
        : json({ message: "Log expired" }, 410);
    }
    if (request.method === "GET" && parts[0] === "runs" && parts[1] && parts[2] === "artifacts") {
      const run = await actions.get(actor, owner, repo, parts[1]);
      const artifact = run.artifacts.find((a) => a.name === url.searchParams.get("name"));
      if (!artifact || !env.ACTIONS_BUCKET) return json({ message: "Artifact not found" }, 404);
      const object = await env.ACTIONS_BUCKET.get(artifact.key);
      return object
        ? new Response(object.body, {
            headers: {
              "content-type": "application/octet-stream",
              "content-disposition": `attachment; filename="${artifact.name.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          })
        : json({ message: "Artifact expired" }, 410);
    }
    const operation = actionHttpOperation(request.method, parts);
    let args: Record<string, unknown> = {};
    if (request.method === "GET") {
      args = {
        runId: parts[1],
        before: url.searchParams.has("before") ? Number(url.searchParams.get("before")) : undefined,
      };
    } else if (request.method === "POST") {
      args = PublicArgumentsSchema.parse(JSON.parse(await boundedBody(request, 65536)));
      if (parts[1]) args.runId = parts[1];
    } else return json({ message: "Method not allowed" }, 405);
    const result = await publicAction(actions, actor, owner, repo, operation, args);
    if (operation === "cancel" && env.ACTIONS_WORKER)
      ctx.waitUntil(
        env.ACTIONS_WORKER.fetch(
          new Request(`https://actions.internal/cancel/${String(args.runId)}`, {
            method: "POST",
            headers: { authorization: `Bearer ${env.ACTIONS_INTERNAL_TOKEN}` },
          }),
        ).then(() => {}),
      );
    if (["run", "rerun", "retry-events"].includes(operation)) ctx.waitUntil(dispatchActions());
    return json(result);
  } catch (error) {
    if (error instanceof ForgeError)
      return json({ message: error.message, code: error.code }, error.status);
    if (error instanceof SyntaxError || (error instanceof Error && error.name.includes("Zod")))
      return json({ message: "Invalid Actions request" }, 422);
    console.error("Actions request failed", {
      path,
      error: error instanceof Error ? error.name : "error",
    });
    return json({ message: "Actions request failed" }, 500);
  }
}
async function boundedBody(request: Request, max: number) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) {
        await reader.cancel();
        throw new ForgeError("Request too large", 413, "size");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}
