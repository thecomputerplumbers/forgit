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
    onAuthEvent: async (event) => {
      await recordAuthEvent(getServices("auth").store, event);
    },
  });
});
