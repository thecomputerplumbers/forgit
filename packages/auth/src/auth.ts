import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { sso } from "@better-auth/sso";
import { organization } from "better-auth/plugins";
import { drizzle, type AnyD1Database } from "drizzle-orm/d1";

import * as schema from "./schema.ts";

export function createAuthDb(database: AnyD1Database) {
  return drizzle(database);
}

export type AuthDb = ReturnType<typeof createAuthDb>;

export type CreateAuthOptions = {
  db: AuthDb;
  secret: string;
  baseURL: string;
  trustedOrigins?: string[];
  google?: { clientId: string; clientSecret: string };
  sendInvitationEmail?: (input: {
    id: string;
    email: string;
    role: string;
    organization: { name: string };
  }) => Promise<void>;
  onAuthEvent?: (event: {
    action: "auth.sign_up" | "auth.sign_in";
    userId: string;
  }) => Promise<void>;
};

/**
 * Browser identity for forgit.
 *
 * Do not construct this at module scope in a Worker. Better Auth queries the
 * database during setup, and workerd forbids I/O outside a request.
 * Machine access uses personal access tokens, not this session.
 */
export function createAuth(options: CreateAuthOptions) {
  return betterAuth({
    database: drizzleAdapter(options.db, { provider: "sqlite", schema }),
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: options.trustedOrigins ?? [options.baseURL],
    socialProviders: options.google
      ? {
          google: {
            clientId: options.google.clientId,
            clientSecret: options.google.clientSecret,
            prompt: "select_account",
          },
        }
      : undefined,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      database: { generateId: "uuid" },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 3600, max: 10 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await options.onAuthEvent?.({ action: "auth.sign_up", userId: user.id });
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            await options.onAuthEvent?.({ action: "auth.sign_in", userId: session.userId });
          },
        },
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: options.sendInvitationEmail,
      }),
      sso({
        organizationProvisioning: { disabled: false, defaultRole: "member" },
        domainVerification: { enabled: true },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

export function lazyAuth(factory: () => Auth): Auth {
  let instance: Auth | undefined;
  const resolve = () => (instance ??= factory());
  return new Proxy({} as Auth, {
    get: (_target, property) => Reflect.get(resolve(), property),
    has: (_target, property) => Reflect.has(resolve(), property),
  });
}

const DEVELOPMENT_SECRET = "forgit-development-secret-change-me!!";

export function resolveSecret(secret: string | undefined, appUrl: string | undefined): string {
  if (secret && secret.length >= 32) return secret;
  const host = appUrl ? new URL(appUrl).hostname : "localhost";
  if (host === "localhost" || host === "127.0.0.1") return DEVELOPMENT_SECRET;
  throw new Error("BETTER_AUTH_SECRET must be set to at least 32 characters");
}
