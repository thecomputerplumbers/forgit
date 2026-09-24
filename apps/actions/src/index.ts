import { CiSandbox } from "@cloudflare/ci/worker";
import { getSandbox } from "@cloudflare/sandbox";
import { safeEqual } from "@forgit/auth/crypto";
import { getRun } from "./rpc.ts";
import type { Bindings } from "./env.ts";
export { CiSandbox };
export { ActionsWorkflow } from "./workflow.ts";

export default {
  async fetch(request: Request, env: Bindings) {
    if (
      !env.ACTIONS_INTERNAL_TOKEN ||
      !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${env.ACTIONS_INTERNAL_TOKEN}`)
    )
      return new Response("Unauthorized", { status: 401 });
    const match = new URL(request.url).pathname.match(/^\/cancel\/([a-z0-9-]+)$/);
    if (request.method === "POST" && match) {
      const { run } = await getRun(env, match[1]!);
      if (!run.cancelRequested && run.status !== "completed")
        return new Response("Run is active", { status: 409 });
      await Promise.all(
        [
          ...run.jobs.flatMap((j) => (j.sandboxId ? [j.sandboxId] : [])),
          ...(run.healing?.sandboxIds ?? []),
        ].map((id) => getSandbox(env.SANDBOX, id, { transport: "rpc" }).destroy()),
      );
      try {
        await (await env.CI_WORKFLOW.get(run.id)).terminate();
      } catch {
        /* A queued run may not have a Workflow yet. */
      }
      return Response.json({ cancelled: true });
    }
    return Response.json({ ok: true });
  },
  async queue(batch: MessageBatch<{ runId: string }>, env: Bindings) {
    for (const message of batch.messages) {
      try {
        const { run, settings } = await getRun(env, message.body.runId);
        if (run.status === "completed" || !settings.enabled) {
          message.ack();
          continue;
        }
        await env.CI_WORKFLOW.createBatch([
          {
            id: run.id,
            params: {
              provider: "forgit",
              providerData: { runId: run.id },
              event: { type: run.trigger },
              owner: run.owner,
              repo: run.repo,
              sha: run.sha,
              ref: run.ref,
              trigger: run.ref.startsWith("refs/tags/") ? "tag" : "push",
              branch: run.ref.replace(/^refs\/heads\//, ""),
            },
          },
        ]);
        message.ack();
      } catch {
        message.retry({ delaySeconds: 30 });
      }
    }
  },
} satisfies ExportedHandler<Bindings, { runId: string }>;
