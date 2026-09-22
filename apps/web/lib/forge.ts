import { env } from "cloudflare:workers";
import { createSqlStore, d1Sql } from "@forgit/db/sql-store";
import { createServices, type Actor, type Services } from "@forgit/domain";
import { HttpGitClient } from "@forgit/git-client";

export function getServices(principal: string): Services {
  const origin = new URL(env.APP_URL).origin;
  const store = createSqlStore(d1Sql(env.DB));
  const git = new HttpGitClient({
    baseUrl: env.WALGIT_URL || "http://git.internal",
    serviceToken: env.WALGIT_TOKEN_FORGIT,
    mergeToken: env.MERGE_INTERNAL_TOKEN,
    principal,
    fetch: env.WALGIT_URL ? undefined : containerFetch(),
  });
  return createServices(store, git, origin);
}

function containerFetch(): typeof fetch {
  const namespace = env.GIT_CONTAINER;
  const stub = namespace.get(namespace.idFromName("forgit"));
  return (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url).pathname + new URL(url).search;
    if (!env.WALGIT_URL && !(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY)) {
      return Promise.resolve(new Response("Git storage is not configured", { status: 503 }));
    }
    const body = init?.body;
    const forwarded = {
      ...init,
      body,
      duplex: body ? "half" : undefined,
    } as unknown as RequestInit;
    return stub.fetch(new Request(`http://container${path}`, forwarded));
  };
}

export async function actorForUser(services: Services, userId: string): Promise<Actor> {
  const existing = await services.store.getUser(userId);
  if (!existing) throw new Error("Signed-in user is missing from the directory");
  if (!existing.login || existing.login === existing.email) {
    const base =
      (existing.email.split("@")[0] ?? "user").toLowerCase().replace(/[^a-z0-9-]/g, "") || "user";
    let login = base.slice(0, 32);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const taken = await services.store.getUserByLogin(login);
      if (!taken || taken.id === userId) break;
      login = `${base.slice(0, 24)}-${attempt + 2}`;
    }
    await services.store.upsertLogin(userId, login, services.store.now());
  }
  return services.actorFromUser(userId);
}
