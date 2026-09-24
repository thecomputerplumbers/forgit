import * as z from "zod/mini";
import { ForgeError } from "@forgit/domain";
import type { ActionsService } from "./service.ts";
import { safeRepairPath } from "./security.ts";

export const RepairSchema = z.compile(
  z.strictObject({
    summary: z.string().check(z.minLength(1), z.maxLength(8000)),
    edits: z
      .array(
        z.strictObject({
          path: z.string().check(z.maxLength(250)),
          contents: z.string().check(z.maxLength(32000)),
        }),
      )
      .check(z.minLength(1), z.maxLength(10)),
  }),
);
export type Repair = z.infer<typeof RepairSchema>;
export async function healingGrant(actions: ActionsService, id: string) {
  const run = await actions.store.get(id);
  if (!run) throw new ForgeError("Run not found", 404, "not_found");
  const { settings, actor } = await actions.allowed(run.repositoryId);
  if (
    settings.healing === "off" ||
    run.conclusion !== "failure" ||
    run.cancelRequested ||
    run.healing ||
    run.ref.startsWith("refs/heads/actions/fix/") ||
    !run.ref.startsWith("refs/heads/") ||
    run.workflow.jobs.some((j) => j.environment) ||
    !run.jobs.some((j) => j.conclusion === "failure")
  )
    throw new ForgeError("Run is not eligible for healing", 409, "healing");
  if (!(await actions.store.acquire(run, "__healing", settings.concurrency))) {
    await actions.store.update(id, (current) => {
      if (!current.healing)
        current.healing = {
          status: "skipped",
          mode: settings.healing as "repair" | "diagnose",
          error: "No execution slot available",
        };
    });
    throw new ForgeError("Healing capacity unavailable", 409, "capacity");
  }
  await actions.store.update(id, (current) => {
    if (current.healing || current.cancelRequested)
      throw new ForgeError("Healing already claimed", 409, "healing");
    current.healing = {
      status: "running",
      mode: settings.healing as "repair" | "diagnose",
      startedAt: actions.store.now(),
    };
  });
  const token = await actions.readCredential(run, actor, 25, "healing");
  return { token: token.plaintext, mode: settings.healing };
}
export async function publishRepair(actions: ActionsService, id: string, input: unknown) {
  const repair = RepairSchema.parse(input);
  if (
    repair.edits.some((e) => !safeRepairPath(e.path)) ||
    new Set(repair.edits.map((e) => e.path)).size !== repair.edits.length
  )
    throw new ForgeError("Repair changes a protected or duplicate path", 422, "repair");
  const run = await actions.store.get(id);
  if (!run) throw new ForgeError("Run not found", 404, "not_found");
  if (run.healing?.status === "proposed") return run;
  const { settings, actor } = await actions.allowed(run.repositoryId);
  if (
    settings.healing !== "repair" ||
    run.healing?.status !== "running" ||
    run.healing.mode !== "repair" ||
    run.conclusion !== "failure" ||
    run.cancelRequested ||
    run.workflow.jobs.some((j) => j.environment) ||
    !run.ref.startsWith("refs/heads/") ||
    run.ref.startsWith("refs/heads/actions/fix/")
  )
    throw new ForgeError("Repair is not authorized", 403, "repair");
  if ((await actions.forge.git.resolve(run.owner, run.repo, run.ref)) !== run.sha)
    throw new ForgeError("Source branch advanced; repair was not published", 409, "stale_head");
  // Only the trusted execution Worker calls this after independent verification.
  // All Git writes use the configured user's principal, never the merge service.
  const forge = actions.options.forActor?.(actor);
  if (!forge) throw new ForgeError("Repair publisher is not configured", 503, "configuration");
  await forge.requireRepo(actor, run.owner, run.repo, "write");
  for (const edit of repair.edits) {
    const original = await forge.git.blob(run.owner, run.repo, run.sha, edit.path);
    if (!original || original.binary)
      throw new ForgeError("Repair may only update existing text files", 422, "repair");
    const tree = await forge.git.tree(
      run.owner,
      run.repo,
      run.sha,
      edit.path.split("/").slice(0, -1).join("/"),
    );
    if (tree?.entries.find((e) => e.name === edit.path.split("/").at(-1))?.mode === "120000")
      throw new ForgeError("Repair cannot edit symlinks", 422, "repair");
  }
  const branch = `actions/fix/${run.id}`;
  // A durable one-shot claim prevents replaying Git writes after an uncertain outcome.
  await actions.store.update(id, (current) => {
    if (current.healing?.branch)
      throw new ForgeError("Repair publication already claimed", 409, "repair");
    current.healing!.branch = branch;
  });
  if (await forge.git.resolve(run.owner, run.repo, branch))
    throw new ForgeError("Repair branch already exists", 409, "repair");
  await forge.git.createBranch({ owner: run.owner, repo: run.repo, branch, fromRef: run.sha });
  const user = await forge.store.getUser(actor.userId);
  let commit = run.sha;
  for (const edit of repair.edits) {
    commit = (
      await forge.git.writeFile({
        owner: run.owner,
        repo: run.repo,
        branch,
        path: edit.path,
        contents: edit.contents,
        message: `fix: proposed repair for ${run.workflow.name}`,
        authorName: actor.login,
        authorEmail: user?.email ?? "actions@forgit.local",
      })
    ).commitSha;
  }
  const pr = await forge.openPullRequest(actor, run.owner, run.repo, {
    sourceRef: branch,
    targetRef: run.ref.replace(/^refs\/heads\//, ""),
    title: `Fix ${run.workflow.name}: automated proposal`,
    body: `Proposed by Forgit Actions for run ${run.id} at ${run.sha}.\n\n${repair.summary}\n\nAll original workflow commands passed in fresh verification sandboxes without deployment credentials. Proposed commit: ${commit}. The original run remains failed. Review this change and its new CI run before merging.`,
    idempotencyKey: `actions-repair:${id}`,
  });
  await actions.audit(actor, run.repositoryId, "repair", `${id}/${pr.number}`);
  return actions.store.update(id, (current) => {
    current.healing = {
      ...current.healing!,
      status: "proposed",
      summary: repair.summary,
      branch,
      commit,
      pullNumber: pr.number,
      completedAt: actions.store.now(),
    };
  });
}
