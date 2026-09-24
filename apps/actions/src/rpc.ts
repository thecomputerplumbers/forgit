import * as z from "zod/mini";
import { ActionRunSchema, ActionSettingsSchema } from "@forgit/actions";
import type { Bindings } from "./env.ts";

export const RunBundleSchema = z.compile(
  z.strictObject({ run: ActionRunSchema, settings: ActionSettingsSchema }),
);
export const GrantSchema = z.compile(
  z.union([
    z.strictObject({ ready: z.literal(false), reason: z.string() }),
    z.strictObject({
      ready: z.literal(true),
      token: z.string(),
      tokenId: z.string(),
      secrets: z.record(z.string(), z.string()),
      deploymentId: z.optional(z.string()),
    }),
  ]),
);
export async function rpc<T>(
  env: Bindings,
  op: string,
  runId: string,
  schema: z.ZodMiniType<T>,
  data?: unknown,
  jobId?: string,
): Promise<T> {
  const response = await env.FORGIT.fetch(
    new Request("https://forgit.internal/api/actions/internal", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.ACTIONS_INTERNAL_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ op, runId, jobId, data }),
    }),
  );
  if (!response.ok) {
    const body = (await response.json()) as { message?: string };
    throw new Error(body.message ?? `Forgit request failed (${response.status})`);
  }
  return schema.parse(await response.json());
}
export const getRun = (env: Bindings, id: string) => rpc(env, "get", id, RunBundleSchema);
export const update = (env: Bindings, op: string, id: string, data?: unknown, jobId?: string) =>
  rpc(env, op, id, ActionRunSchema, data, jobId);
