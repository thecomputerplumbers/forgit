import { env } from "cloudflare:workers";
import { createAuth, createAuthDb, lazyAuth, resolveSecret } from "@forgit/auth";
import { recordAuthEvent } from "@forgit/domain";
import { d1Sql } from "@forgit/db/sql-store";

import { getServices } from "./forge.ts";
import { applyInvitationGrants } from "./invitation-grants.ts";

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
    sendInvitationEmail: async ({ id, email, organization }) => {
      const url = `${origin}/invitations/${encodeURIComponent(id)}`;
      await env.EMAIL.send({
        from: { email: "seth@thecomputerplumbers.com", name: "Forgit" },
        to: email,
        subject: `Invitation to ${organization.name} on Forgit`,
        text: `You've been invited to ${organization.name} on Forgit. Open this link to join: ${url}\n\nThis invitation expires in 48 hours.`,
      });
    },
    onInvitationAccepted: async (input) => {
      await applyInvitationGrants(d1Sql(env.DB), { ...input, now: Date.now() });
    },
    onAuthEvent: async (event) => {
      await recordAuthEvent(getServices("auth").store, event);
    },
  });
});
