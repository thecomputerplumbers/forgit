import * as z from "zod/mini";
import { ForgeError, type Actor } from "@forgit/domain";
import { JobResultSchema, StepResultSchema, ArtifactSchema, HealingSchema } from "./types.ts";
import type { ActionsService } from "./service.ts";

import { healingGrant, publishRepair } from "./healing.ts";

const Text = z.string().check(z.minLength(1), z.maxLength(256));
export const InternalRequestSchema = z.compile(
  z.strictObject({
    op: z.enum([
      "get",
      "grant",
      "job-start",
      "step",
      "job-finish",
      "finish",
      "artifact",
      "healing",
      "healing-grant",
      "healing-sandbox",
      "healing-cleanup",
      "repair",
    ]),
    runId: Text,
    jobId: z.optional(Text),
    data: z.optional(z.unknown()),
  }),
);
const JobStartSchema = z.compile(
  z.strictObject({ sandboxId: Text, deploymentId: z.optional(Text) }),
);
const JobFinishSchema = z.compile(
  z.strictObject({
    conclusion: z.enum([
      "success",
      "failure",
      "cancelled",
      "skipped",
      "timed_out",
      "infrastructure_error",
    ]),
    error: z.optional(z.string().check(z.maxLength(20000))),
  }),
);
export async function internalAction(actions: ActionsService, input: unknown) {
  const { op, runId, jobId, data } = InternalRequestSchema.parse(input);
  const run = await actions.store.get(runId);
  if (!run) throw new ForgeError("Run not found", 404, "not_found");
  switch (op) {
    case "get":
      return { run, settings: await actions.store.settings(run.repositoryId) };
    case "grant":
      return actions.jobGrant(runId, jobId ?? "");
    case "job-start": {
      const start = JobStartSchema.parse(data);
      return actions.recordJob(runId, jobId ?? "", (state) => {
        if (state.startedAt) throw new ForgeError("Job cannot be replayed", 409, "replay");
        state.status = "in_progress";
        state.startedAt = actions.store.now();
        state.sandboxId = start.sandboxId;
        state.deploymentId = start.deploymentId;
      });
    }
    case "step": {
      const step = StepResultSchema.parse(data);
      return actions.recordJob(runId, jobId ?? "", (state) => {
        const existing = state.steps.find((s) => s.id === step.id);
        if (!existing) throw new ForgeError("Unknown step", 422, "step");
        if (existing.status === "completed") return;
        if (existing.command !== step.command || existing.name !== step.name)
          throw new ForgeError("Step identity changed", 422, "step");
        Object.assign(existing, step);
      });
    }
    case "job-finish": {
      const result = JobFinishSchema.parse(data);
      return actions.jobFinished(runId, jobId ?? "", result.conclusion, result.error);
    }
    case "finish":
      return actions.finish(runId, typeof data === "string" ? data.slice(0, 20000) : undefined);
    case "artifact": {
      const artifact = ArtifactSchema.parse(data);
      if (!artifact.key.startsWith(`runs/${run.id}/`) || artifact.jobId !== jobId)
        throw new ForgeError("Invalid artifact ownership", 403, "artifact");
      return actions.store.update(runId, (current) => {
        if (current.status === "completed") return false;
        current.artifacts = current.artifacts
          .filter((a) => a.key !== artifact.key)
          .concat(artifact);
      });
    }
    case "healing": {
      const healing = HealingSchema.parse(data);
      return actions.store.update(runId, (current) => {
        if (current.conclusion !== "failure" || current.cancelRequested)
          throw new ForgeError("Run cannot be healed", 409, "healing");
        if (current.healing?.status === "proposed") return false;
        current.healing = { ...healing, sandboxIds: current.healing?.sandboxIds };
      });
    }
    case "healing-sandbox": {
      const sandboxId = Text.parse(data);
      return actions.store.update(runId, (current) => {
        if (current.healing?.status !== "running" || current.cancelRequested)
          throw new ForgeError("Healing is not active", 409, "healing");
        current.healing.sandboxIds = [
          ...new Set([...(current.healing.sandboxIds ?? []), sandboxId]),
        ];
      });
    }
    case "healing-grant":
      return healingGrant(actions, runId);
    case "healing-cleanup":
      await actions.store.release(runId, "__healing");
      await actions.revokeCredentials(run);
      return run;
    case "repair":
      return publishRepair(actions, runId, data);
  }
}
export async function publicAction(
  actions: ActionsService,
  actor: Actor,
  owner: string,
  repo: string,
  operation: string,
  args: Record<string, unknown>,
) {
  const id = String(args.runId ?? "");
  switch (operation) {
    case "list":
      return {
        runs: await actions.list(
          actor,
          owner,
          repo,
          typeof args.before === "number" ? args.before : undefined,
        ),
      };
    case "get":
      return { run: await actions.get(actor, owner, repo, id) };
    case "run":
      return {
        run: await actions.manual(actor, owner, repo, { workflow: args.workflow, ref: args.ref }),
      };
    case "rerun":
      return { run: await actions.rerun(actor, owner, repo, id) };
    case "cancel":
      return { run: await actions.cancel(actor, owner, repo, id) };
    case "approve":
      return { run: await actions.approve(actor, owner, repo, id, String(args.jobId ?? "")) };
    case "settings": {
      const { repo: repository } = await actions.access(actor, owner, repo, "admin");
      return {
        settings: await actions.store.settings(repository.id),
        environments: await actions.store.environments(repository.id),
      };
    }
    case "retry-events": {
      const { repo: repository } = await actions.access(actor, owner, repo, "admin");
      await actions.store.retryEvents(repository.id);
      await actions.audit(actor, repository.id, "retry-events", repository.id);
      return { retried: true };
    }
    case "configure":
      return { settings: await actions.configure(actor, owner, repo, args) };
    case "environment":
      return { environment: await actions.setEnvironment(actor, owner, repo, args) };
    case "secret":
      return actions.setSecret(
        actor,
        owner,
        repo,
        String(args.environment ?? ""),
        String(args.name ?? ""),
        args.value === null ? null : String(args.value ?? ""),
      );
    case "deployments": {
      const { repo: repository } = await actions.access(actor, owner, repo);
      return { deployments: await actions.store.deployments(repository.id) };
    }
    default:
      throw new ForgeError("Unknown Actions operation", 404, "not_found");
  }
}
export { JobResultSchema };

export const PublicArgumentsSchema = z.compile(z.record(z.string(), z.unknown()));
export function actionHttpOperation(method: string, parts: string[]): string {
  if (parts[0] === "runs") {
    if (method === "GET" && parts.length === 1) return "list";
    if (method === "GET" && parts.length === 2 && parts[1]) return "get";
    if (method === "POST" && parts.length === 1) return "run";
    if (
      method === "POST" &&
      parts.length === 3 &&
      parts[1] &&
      ["rerun", "cancel", "approve"].includes(parts[2]!)
    )
      return parts[2]!;
  } else if (parts.length === 1) {
    if (method === "GET" && ["settings", "deployments"].includes(parts[0]!)) return parts[0]!;
    if (
      method === "POST" &&
      ["configure", "environment", "secret", "retry-events"].includes(parts[0]!)
    )
      return parts[0]!;
  }
  throw new ForgeError("Method or Actions route not allowed", 405, "method");
}
