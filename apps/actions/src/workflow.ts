import { CIWorkflow, isCiRunnerFailure, type CiContext, type CiParams } from "@cloudflare/ci";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { forgitProvider, type ForgitProvider } from "./provider.ts";
import type { Bindings } from "./env.ts";
import { getRun, update } from "./rpc.ts";

import { heal } from "./healing.ts";

export class ActionsWorkflow extends CIWorkflow<ForgitProvider, Bindings> {
  static override getProvider() {
    return forgitProvider;
  }
  protected async pipeline(
    event: WorkflowEvent<CiParams<ForgitProvider>>,
    step: WorkflowStep,
    ci: CiContext,
  ): Promise<void> {
    const id = event.instanceId;
    const { run } = await step.do("load-run", () => getRun(this.env, id));
    if (run.id !== event.payload.providerData.runId || run.sha !== event.payload.sha)
      throw new Error("Run identity does not match Workflow input");
    const work = new Map<string, Promise<boolean>>();
    const execute = (jobId: string): Promise<boolean> => {
      const existing = work.get(jobId);
      if (existing) return existing;
      const job = run.workflow.jobs.find((j) => j.id === jobId)!;
      const promise = (async () => {
        const dependencies = await Promise.all(job.needs.map(execute));
        if (dependencies.some((ok) => !ok)) {
          await step.do(`skip-${jobId}`, () =>
            update(this.env, "job-finish", id, { conclusion: "skipped" }, jobId),
          );
          return false;
        }
        try {
          await ci.runner({
            name: jobId,
            command: job.steps.map((s) => s.run).join("\n"),
            config: {
              retries: { limit: 0, delay: 0 },
              timeout: (job.timeoutMinutes + 40) * 60000,
              commandTimeoutMs: job.timeoutMinutes * 60000,
              snapshotRetentionSeconds: 3600,
            },
          });
          return true;
        } catch (error) {
          if (!isCiRunnerFailure(error)) throw error;
          return false;
        }
      })();
      work.set(jobId, promise);
      return promise;
    };
    try {
      const settled = await Promise.allSettled(run.workflow.jobs.map((j) => execute(j.id)));
      const rejected = settled.find((result) => result.status === "rejected");
      if (rejected?.status === "rejected") throw rejected.reason;
    } catch (error) {
      await step.do("finish-error", () =>
        update(this.env, "finish", id, error instanceof Error ? error.message : "Execution failed"),
      );
      throw error;
    }
    const result = await step.do("finish-run", () => update(this.env, "finish", id));
    if (result.conclusion === "failure")
      await step.do(
        "diagnose-and-propose",
        { retries: { limit: 0, delay: 0 }, timeout: "25 minutes" },
        () => heal(this.env, id),
      );
    if (result.conclusion !== "success") throw new Error(`Forgit Actions ${result.conclusion}`);
  }
}
