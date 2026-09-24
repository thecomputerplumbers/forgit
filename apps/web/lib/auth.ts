import { env } from "cloudflare:workers";
import { createAuth, createAuthDb, lazyAuth, resolveSecret } from "@forgit/auth";
import { recordAuthEvent } from "@forgit/domain";

import { getServices } from "./forge.ts";

export const auth = lazyAuth(() => {
  if (!env.APP_URL) throw new Error("APP_URL must be configured");
  const origin = new URL(env.APP_URL).origin;
  return createAuth({
    db: createAuthDb(env.DB),
    secret: resolveSecret(env.BETTER_AUTH_SECRET, origin),
    baseURL: origin,
    trustedOrigins: [origin, "https://auth.thecomputerplumbers.com"],
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : undefined,
    onAuthEvent: async (event) => {
      await recordAuthEvent(getServices("auth").store, event);
    },
  });
});
