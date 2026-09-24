// Local-only harness. It never binds Workers AI or accepts production traffic.
import { ActionsWorkflow } from "../../apps/actions/src/workflow.ts";
import handler, { CiSandbox } from "../../apps/actions/src/index.ts";
import type { Bindings } from "../../apps/actions/src/env.ts";
export { CiSandbox };
export class SmokeWorkflow extends ActionsWorkflow {
  override async run(...args: Parameters<ActionsWorkflow["run"]>) {
    this.env.AI = {
      run: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: "verify",
                proposal: {
                  summary: "Correct the fixture return value.",
                  edits: [{ path: "src/value.mjs", contents: "export default 2;\n" }],
                },
              }),
            },
          },
        ],
      }),
    } as unknown as Ai;
    return super.run(...args);
  }
}
export default {
  async fetch(request: Request, env: Bindings) {
    const url = new URL(request.url);
    if (request.method === "GET") return new Response("ready");
    if (url.pathname.startsWith("/cancel/")) return handler.fetch(request, env);
    if (url.pathname === "/log") {
      const { key } = (await request.json()) as { key: string };
      return new Response(await (await env.BACKUP_BUCKET.get(key))?.text());
    }
    const data = (await request.json()) as {
      id: string;
      sha: string;
      ref: string;
      owner: string;
      repo: string;
    };
    await env.CI_WORKFLOW.create({
      id: data.id,
      params: {
        provider: "forgit",
        providerData: { runId: data.id },
        event: { type: "workflow_dispatch" },
        owner: data.owner,
        repo: data.repo,
        sha: data.sha,
        ref: data.ref,
        trigger: "push",
        branch: data.ref.replace(/^refs\/heads\//, ""),
      },
    });
    return Response.json({ started: true });
  },
} satisfies ExportedHandler<Bindings>;
