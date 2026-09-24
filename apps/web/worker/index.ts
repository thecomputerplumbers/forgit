import { Container } from "@cloudflare/containers";
import { classifyPath, lfsBatchWrites, type Classified } from "@forgit/git-client";
import { handleGithubGraphql, handleGithubRest } from "@forgit/github-compat";
import { handleMcp } from "@forgit/mcp";
import { logEvent, requestIdFrom } from "@forgit/observability";
import { d1Sql } from "@forgit/db/sql-store";
import vinextWorker from "vinext/server/app-router-entry";

import { actionsHttp } from "../lib/actions-http.ts";
import { dispatchActions, getActions } from "../lib/actions.ts";
import { getServices } from "../lib/forge.ts";
import { GIT_CONTAINER_NAME } from "../lib/git-container.ts";
import { deliverBillingUsage } from "../lib/billing-delivery.ts";

export class GitContainer extends Container<Cloudflare.Env> {
  defaultPort = 8080;
  sleepAfter = "60m";

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Cloudflare.Env) {
    super(ctx, env);
    // Read at start, before onStart. Missing R2 keys are omitted so a
    // half-configured boot does not overwrite a later secret with "".
    const vars: Record<string, string> = {
      WALGIT__SERVER__PUBLIC_URL: env.APP_URL,
    };
    if (env.WALGIT_TOKEN_FORGIT) vars.WALGIT_TOKEN_FORGIT = env.WALGIT_TOKEN_FORGIT;
    if (env.MERGE_INTERNAL_TOKEN) vars.MERGE_INTERNAL_TOKEN = env.MERGE_INTERNAL_TOKEN;
    if (env.R2_ENDPOINT) vars.WALGIT__STORE__S3__ENDPOINT = env.R2_ENDPOINT;
    if (env.GIT_BUCKET) vars.WALGIT__STORE__BUCKET = env.GIT_BUCKET;
    if (env.R2_ACCESS_KEY_ID) vars.AWS_ACCESS_KEY_ID = env.R2_ACCESS_KEY_ID;
    if (env.R2_SECRET_ACCESS_KEY) vars.AWS_SECRET_ACCESS_KEY = env.R2_SECRET_ACCESS_KEY;
    if (env.ACTIONS_EVENT_SECRET) {
      vars.WALGIT__EVENTS__WEBHOOK_URL = `${env.APP_URL}/api/actions/events`;
      vars.WALGIT__EVENTS__WEBHOOK_SECRET = env.ACTIONS_EVENT_SECRET;
      vars.WALGIT__EVENTS__SWEEP_INTERVAL = "10s";
    }
    this.envVars = vars;
  }

  override onStart() {
    console.log(JSON.stringify({ event: "git-container.start" }));
  }

  override onStop(params: Parameters<Container<Cloudflare.Env>["onStop"]>[0]) {
    console.log(
      JSON.stringify({
        event: "git-container.stop",
        exitCode: params.exitCode,
        reason: params.reason,
      }),
    );
  }

  override onError(error: unknown): never {
    console.error(
      JSON.stringify({
        event: "git-container.error",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
}

const READ_LIMIT = { windowMs: 60_000, max: 120 };
const WRITE_LIMIT = { windowMs: 60_000, max: 30 };

export default {
  async scheduled(_controller: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    ctx.waitUntil(dispatchActions());
    if (env.HOSTED_MODE === "true" && env.BILLING_DELIVERY_ENABLED === "true") {
      if (!env.METRONOME_API_KEY) throw new Error("Billing delivery enabled without Metronome key");
      ctx.waitUntil(deliverBillingUsage(d1Sql(env.DB), env.METRONOME_API_KEY));
    }
  },
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const requestId = requestIdFrom(request.headers);
    const url = new URL(request.url);
    const classified = classifyPath(url.pathname, request.method);
    try {
      if (url.pathname === "/api/actions/events" || url.pathname === "/api/actions/internal") {
        return (await actionsHttp(request, null, ctx))!;
      }
      if (classified.kind === "health") {
        return json({ ok: true, plane: "control", requestId });
      }
      if (classified.kind === "ready") {
        return ready(env, requestId);
      }
      if (classified.kind === "git") {
        return proxyGit(request, env, classified, requestId);
      }
      if (
        url.pathname === "/mcp" ||
        url.pathname === "/api/v3" ||
        url.pathname.startsWith("/api/v3/") ||
        url.pathname === "/api/graphql"
      ) {
        return api(request, env, requestId, ctx);
      }
      const pageHeaders = new Headers(request.headers);
      pageHeaders.set("x-request-id", requestId);
      return vinextWorker.fetch(new Request(request, { headers: pageHeaders }), env, ctx);
    } catch (error) {
      logEvent("request.error", {
        requestId,
        path: url.pathname,
        message: error instanceof Error ? error.message : "failed",
      });
      return new Response("Internal error", {
        status: 500,
        headers: { "x-request-id": requestId },
      });
    }
  },
} satisfies ExportedHandler<Cloudflare.Env>;

async function api(
  request: Request,
  env: Cloudflare.Env,
  requestId: string,
  ctx: ExecutionContext,
) {
  const directory = getServices("directory", requestId);
  const actor = await directory.actorFromAuthorization(request.headers.get("authorization"));
  const services = getServices(actor?.login ?? "anonymous", requestId);
  const key = `api:${actor?.userId ?? request.headers.get("cf-connecting-ip") ?? "anon"}`;
  const rate = await services.store.takeRate(key, services.store.now(), 60_000, actor ? 300 : 30);
  if (!rate.ok) return json({ message: "Rate limit exceeded" }, 429, requestId);
  const actionResponse = await actionsHttp(request, actor, ctx);
  if (actionResponse) return actionResponse;
  const context = { services, actor, origin: new URL(env.APP_URL).origin };
  const response = request.url.includes("/api/graphql")
    ? await handleGithubGraphql(request, context)
    : urlPath(request) === "/mcp"
      ? await handleMcp(request, services, actor, {
          service: getActions(),
          readLog: async (key) => (await env.ACTIONS_BUCKET?.get(key))?.text() ?? null,
          changed: async (operation, id) => {
            if (operation === "cancel" && env.ACTIONS_WORKER)
              await env.ACTIONS_WORKER.fetch(
                new Request(`https://actions.internal/cancel/${id}`, {
                  method: "POST",
                  headers: { authorization: `Bearer ${env.ACTIONS_INTERNAL_TOKEN}` },
                }),
              );
            else ctx.waitUntil(dispatchActions());
          },
        })
      : await handleGithubRest(request, context);
  logEvent("api", {
    requestId,
    path: urlPath(request),
    status: response?.status ?? 404,
    actor: actor?.login ?? "",
  });
  return stamp(response ?? new Response("Not found", { status: 404 }), requestId, ctx);
}

async function proxyGit(
  request: Request,
  env: Cloudflare.Env,
  classified: Extract<Classified, { kind: "git" }>,
  requestId: string,
) {
  const services = getServices("git", requestId);
  let write = classified.write;
  let body: BodyInit | null = request.body;
  if (request.method === "POST" && classified.suffix === "/info/lfs/objects/batch") {
    const text = await request.text();
    write = lfsBatchWrites(text);
    body = text;
  }
  const actor = await services.actorFromAuthorization(request.headers.get("authorization"));
  const loaded = await services
    .requireRepo(actor, classified.owner, classified.repo, write ? "write" : "read")
    .catch((error: unknown) => {
      if (!(error instanceof Error)) throw error;
      return error;
    });
  if (loaded instanceof Error) {
    const status = "status" in loaded && typeof loaded.status === "number" ? loaded.status : 401;
    await services.store.insertAudit({
      id: crypto.randomUUID(),
      actorId: actor?.userId ?? null,
      action: "git.denied",
      repositoryId: null,
      target: `${classified.owner}/${classified.repo}`,
      metadata: { write, status },
      requestId,
      createdAt: services.store.now(),
    });
    return new Response(loaded.message, { status, headers: { "x-request-id": requestId } });
  }
  const limit = write ? WRITE_LIMIT : READ_LIMIT;
  const rate = await services.store.takeRate(
    `git:${actor?.userId ?? "public"}:${classified.owner}/${classified.repo}`,
    services.store.now(),
    limit.windowMs,
    limit.max,
  );
  if (!rate.ok)
    return new Response("Rate limit exceeded", {
      status: 429,
      headers: { "x-request-id": requestId },
    });
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.set("authorization", `Bearer ${env.WALGIT_TOKEN_FORGIT}`);
  headers.set("x-walgit-principal", actor?.login ?? "anonymous");
  headers.set("x-request-id", requestId);
  const target = new Request(request.url, {
    method: request.method,
    headers,
    body,
    duplex: body ? "half" : undefined,
  } as RequestInit);
  const started = Date.now();
  const response = await upstream(env, target);
  logEvent("git", {
    requestId,
    repo: `${classified.owner}/${classified.repo}`,
    write,
    status: response.status,
    ms: Date.now() - started,
    actor: actor?.login ?? "anonymous",
  });
  if (write && response.ok) {
    await services.store.insertAudit({
      id: crypto.randomUUID(),
      actorId: actor?.userId ?? null,
      action: "git.push",
      repositoryId: loaded.repo.id,
      target: `${classified.owner}/${classified.repo}`,
      metadata: { status: response.status },
      requestId,
      createdAt: services.store.now(),
    });
  }
  const outbound = new Response(response.body, response);
  outbound.headers.set("x-request-id", requestId);
  return outbound;
}

function relay(url: string, request: Request): Request {
  const body = request.body;
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body,
    duplex: body ? "half" : undefined,
  } as RequestInit);
}

function gitStorageReady(env: Cloudflare.Env): boolean {
  return Boolean(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);
}

async function upstream(env: Cloudflare.Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = `${url.pathname}${url.search}`;
  if (env.WALGIT_URL) return fetch(relay(`${env.WALGIT_URL}${path}`, request));
  if (!gitStorageReady(env)) {
    return new Response("Git storage is not configured", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const stub = env.GIT_CONTAINER.get(env.GIT_CONTAINER.idFromName(GIT_CONTAINER_NAME));
  return stub.fetch(relay(`http://container${path}`, request));
}

async function ready(env: Cloudflare.Env, requestId: string) {
  const checks: Record<string, string> = { database: "fail", git: "fail", store: "fail" };
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    checks.database = "ok";
  } catch {
    checks.database = "fail";
  }
  // Missing R2 keys must not boot the container. walgit's own /readyz only
  // means the process is up; listing owners is what touches the bucket.
  if (!gitStorageReady(env)) return json({ ok: false, checks, requestId }, 503);
  try {
    const response = await upstream(env, new Request("http://git.internal/readyz"));
    checks.git = response.ok ? "ok" : "fail";
  } catch {
    checks.git = "fail";
  }
  if (checks.git === "ok") {
    try {
      const probe = new Request("http://git.internal/api/v1/owners", {
        headers: { authorization: `Bearer ${env.WALGIT_TOKEN_FORGIT}` },
      });
      const response = await upstream(env, probe);
      checks.store = response.ok ? "ok" : "fail";
    } catch {
      checks.store = "fail";
    }
  }
  const ok = checks.database === "ok" && checks.git === "ok" && checks.store === "ok";
  return json({ ok, checks, requestId }, ok ? 200 : 503);
}

function json(body: unknown, status = 200, requestId?: string) {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  if (requestId) headers.set("x-request-id", requestId);
  return new Response(JSON.stringify(body), { status, headers });
}

function urlPath(request: Request) {
  return new URL(request.url).pathname;
}

function stamp(response: Response, requestId: string, _ctx: ExecutionContext) {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  return new Response(response.body, { status: response.status, headers });
}
