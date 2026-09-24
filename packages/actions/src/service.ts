import * as z from "zod/mini";
import { ForgeError, type Actor, type Services } from "@forgit/domain";
import { hasScope } from "@forgit/auth/scopes";
import { ActionsStore } from "./store.ts";
import { digest, matchesWorkflow, parseWorkflow } from "./workflow.ts";
import { decryptSecret, encryptSecret } from "./security.ts";
import {
  ActionSettingsSchema,
  EnvironmentSchema,
  initialJobs,
  type ActionRun,
  type RefEvent,
  type Trigger,
  type Workflow,
} from "./types.ts";

export const RunRequestSchema = z.compile(
  z.strictObject({
    workflow: z.string().check(z.regex(/^\.forgit\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/)),
    ref: z.string().check(z.minLength(1), z.maxLength(250)),
  }),
);
const finished = (run: ActionRun) => run.status === "completed";
export class ActionsService {
  constructor(
    readonly store: ActionsStore,
    readonly forge: Services,
    readonly options: {
      encryptionKey?: string;
      enabled?: boolean;
      forActor?: (actor: Actor) => Services;
    } = {},
  ) {}
  async access(
    actor: Actor | null,
    owner: string,
    name: string,
    mode: "read" | "write" | "admin" = "read",
  ) {
    if (!actor) throw new ForgeError("Authentication required", 401, "unauthorized");
    // Actions scopes authorize Actions operations; they do not grant Git writes.
    const loaded = await this.forge.requireRepo(actor, owner, name, "read");
    if (mode !== "read") {
      const human = { ...actor, tokenScopes: null };
      await this.forge.requireRepo(human, owner, name, mode);
      if (
        actor.tokenScopes &&
        !hasScope(actor.tokenScopes, mode === "admin" ? "repo:admin" : "workflow:run")
      )
        throw new ForgeError("Actions permission required", 403, "forbidden");
    }
    return loaded;
  }
  async audit(actor: Actor | null, repo: string, action: string, target: string) {
    await this.forge.store.insertAudit({
      id: crypto.randomUUID(),
      actorId: actor?.userId ?? null,
      repositoryId: repo,
      action: `actions.${action}`,
      target,
      metadata: {},
      requestId: null,
      createdAt: this.store.now(),
    });
  }
  async configure(actor: Actor, owner: string, name: string, input: unknown) {
    const { repo } = await this.access(actor, owner, name, "admin");
    const current = await this.store.settings(repo.id);
    const settings = ActionSettingsSchema.parse({
      ...current,
      ...(input as object),
      credentialUserId: actor.userId,
    });
    await this.store.setSettings(repo.id, settings);
    await this.audit(actor, repo.id, "configure", repo.id);
    return settings;
  }
  async list(actor: Actor, owner: string, name: string, before?: number) {
    const { repo } = await this.access(actor, owner, name);
    return this.store.list(repo.id, before);
  }
  async get(actor: Actor, owner: string, name: string, id: string, write = false) {
    const { repo } = await this.access(actor, owner, name, write ? "write" : "read");
    const run = await this.store.get(id);
    if (!run || run.repositoryId !== repo.id)
      throw new ForgeError("Run not found", 404, "not_found");
    return run;
  }
  async discover(owner: string, name: string, sha: string) {
    const tree = await this.forge.git.tree(owner, name, sha, ".forgit/workflows");
    return (tree?.entries ?? [])
      .filter((e) => e.type === "blob" && /^[A-Za-z0-9._-]+\.ya?ml$/.test(e.name))
      .map((e) => `.forgit/workflows/${e.name}`)
      .slice(0, 20);
  }
  async makeRun(input: {
    repositoryId: string;
    owner: string;
    name: string;
    path: string;
    sha: string;
    ref: string;
    trigger: Trigger;
    actorId: string;
    eventKey: string;
    matchRef?: string;
  }) {
    const blob = await this.forge.git.blob(input.owner, input.name, input.sha, input.path);
    if (!blob?.contents) throw new ForgeError("Workflow file not found", 404, "not_found");
    let workflow: Workflow;
    let error: string | undefined;
    try {
      workflow = parseWorkflow(blob.contents);
    } catch (e) {
      error = e instanceof Error ? e.message : "Invalid workflow";
      workflow = { version: 1, name: input.path, on: { [input.trigger]: {} }, jobs: [] };
    }
    if (!error && !matchesWorkflow(workflow, input.trigger, input.matchRef ?? input.ref))
      return null;
    const id = crypto.randomUUID(),
      now = this.store.now();
    const run: ActionRun = {
      id,
      rootId: id,
      attempt: 1,
      repositoryId: input.repositoryId,
      owner: input.owner,
      repo: input.name,
      workflowPath: input.path,
      workflow,
      planDigest: await digest(blob.contents),
      sha: input.sha,
      ref: input.ref,
      trigger: input.trigger,
      actorId: input.actorId,
      eventKey: input.eventKey,
      status: error ? "completed" : "queued",
      conclusion: error ? "failure" : null,
      createdAt: now,
      updatedAt: now,
      jobs: initialJobs(workflow),
      artifacts: [],
      ...(error ? { error, completedAt: now } : {}),
    };
    return this.store.create(run);
  }
  async manual(actor: Actor, owner: string, name: string, value: unknown) {
    const { repo } = await this.access(actor, owner, name, "write");
    await this.allowed(repo.id);
    const input = RunRequestSchema.parse(value);
    const sha = await this.forge.git.resolve(owner, name, input.ref);
    if (!sha) throw new ForgeError("Ref not found", 404, "not_found");
    const ref = input.ref.startsWith("refs/") ? input.ref : `refs/heads/${input.ref}`;
    const run = await this.makeRun({
      repositoryId: repo.id,
      owner,
      name,
      path: input.workflow,
      sha,
      ref,
      trigger: "workflow_dispatch",
      actorId: actor.userId,
      eventKey: `manual:${crypto.randomUUID()}`,
    });
    if (!run) throw new ForgeError("Workflow does not enable manual dispatch", 422, "workflow");
    await this.audit(actor, repo.id, "dispatch", run.id);
    return run;
  }
  async allowed(repoId: string) {
    if (this.options.enabled === false)
      throw new ForgeError("Actions is paused for this installation", 503, "paused");
    const settings = await this.store.settings(repoId);
    const repo = await this.forge.store.getRepository(repoId);
    if (!settings.enabled || !settings.credentialUserId || !repo || repo.archived)
      throw new ForgeError("Actions is disabled for this repository", 403, "disabled");
    const actor = await this.forge.actorFromUser(settings.credentialUserId);
    const org = await this.forge.store.getOrganization(repo.organizationId);
    if (!org) throw new ForgeError("Organization not found", 404, "not_found");
    await this.forge.requireRepo(actor, org.slug, repo.name, "admin");
    return { settings, actor, repo };
  }
  async receive(events: RefEvent[]) {
    for (const event of events) {
      const [owner, name] = event.repo.split("/");
      const org = await this.forge.store.getOrganizationBySlug(owner!);
      const repo = org ? await this.forge.store.getRepositoryByName(org.id, name!) : null;
      if (!repo) continue;
      const settings = await this.store.settings(repo.id);
      // Historical delivery is acknowledged without enabling compute implicitly.
      if (!settings.enabled) continue;
      await this.store.receive(
        `walgit:${repo.id}:${event._walgit.seq}:${event.ref_name}`,
        repo.id,
        { kind: "ref", event },
      );
    }
  }
  async processEvents() {
    for (const receipt of await this.store.pendingEvents()) {
      try {
        const payload = JSON.parse(receipt.document) as { kind: string; event: RefEvent };
        const { repo, settings } = await this.allowed(receipt.repository_id);
        const org = await this.forge.store.getOrganization(repo.organizationId);
        if (!org) throw new Error("Organization missing");
        const event = payload.event;
        if (
          event.action !== "delete" &&
          !/^0+$/.test(event.new) &&
          event.old !== event.new &&
          ["branch", "tag"].includes(event.ref_type)
        ) {
          for (const path of await this.discover(org.slug, repo.name, event.new))
            await this.makeRun({
              repositoryId: repo.id,
              owner: org.slug,
              name: repo.name,
              path,
              sha: event.new,
              ref: event.ref_name,
              trigger: "push",
              actorId: settings.credentialUserId!,
              eventKey: receipt.id,
            });
          if (event.ref_type === "branch")
            for (const pr of await this.forge.store.listPullRequests(repo.id, "open")) {
              if (`refs/heads/${pr.sourceRef}` !== event.ref_name) continue;
              for (const path of await this.discover(org.slug, repo.name, event.new))
                await this.makeRun({
                  repositoryId: repo.id,
                  owner: org.slug,
                  name: repo.name,
                  path,
                  sha: event.new,
                  ref: event.ref_name,
                  matchRef: `refs/heads/${pr.targetRef}`,
                  trigger: "pull_request",
                  actorId: pr.authorId,
                  eventKey: `pr:${pr.id}:${event.new}:${pr.targetRef}`,
                });
            }
        }
        await this.store.processed(receipt.id);
      } catch (error) {
        await this.store.eventError(
          receipt.id,
          error instanceof Error ? error.message : "Event processing failed",
        );
      }
    }
  }
  async reconcilePullRequests() {
    // The PR rows themselves are durable input, including creation before any
    // subsequent push. Deterministic event keys make repeated sweeps harmless.
    const repos = await this.store.sql.all<{ repository_id: string }>(
      "SELECT repository_id FROM action_settings WHERE json_extract(document,'$.enabled')=1",
    );
    for (const { repository_id } of repos) {
      const eligible = await this.allowed(repository_id).catch(() => null);
      if (!eligible) continue;
      const { repo } = eligible;
      const org = await this.forge.store.getOrganization(repo.organizationId);
      if (!org) continue;
      for (const pr of await this.forge.store.listPullRequests(repo.id, "open")) {
        const sha = await this.forge.git.resolve(org.slug, repo.name, pr.sourceRef);
        if (!sha) continue;
        for (const path of await this.discover(org.slug, repo.name, sha))
          await this.makeRun({
            repositoryId: repo.id,
            owner: org.slug,
            name: repo.name,
            path,
            sha,
            ref: `refs/heads/${pr.sourceRef}`,
            matchRef: `refs/heads/${pr.targetRef}`,
            trigger: "pull_request",
            actorId: pr.authorId,
            eventKey: `pr:${pr.id}:${sha}:${pr.targetRef}`,
          });
      }
    }
  }
  async rerun(actor: Actor, owner: string, name: string, id: string) {
    const prior = await this.get(actor, owner, name, id, true);
    await this.allowed(prior.repositoryId);
    if (!finished(prior))
      throw new ForgeError("Finish or cancel this run before rerunning", 409, "running");
    const nextId = crypto.randomUUID(),
      now = this.store.now();
    const next: ActionRun = {
      ...prior,
      id: nextId,
      attempt: prior.attempt + 1,
      eventKey: `rerun:${prior.id}`,
      actorId: actor.userId,
      status: "queued",
      conclusion: null,
      createdAt: now,
      updatedAt: now,
      jobs: initialJobs(prior.workflow),
      artifacts: [],
    };
    for (const key of [
      "completedAt",
      "error",
      "cancelRequested",
      "credentialIds",
      "credentialOwners",
      "healing",
      "version",
      "ordinal",
      "outputExpiredAt",
    ] as const)
      delete next[key];
    const result = await this.store.create(next);
    await this.audit(actor, prior.repositoryId, "rerun", result.id);
    return result;
  }
  async cancel(actor: Actor, owner: string, name: string, id: string) {
    const run = await this.get(actor, owner, name, id, true);
    const result = await this.store.update(id, (current) => {
      if (finished(current)) {
        if (current.healing?.status !== "running") return false;
        current.cancelRequested = true;
        current.healing = {
          ...current.healing,
          status: "failed",
          error: "Investigation cancelled",
          completedAt: this.store.now(),
        };
        return;
      }
      current.cancelRequested = true;
      current.status = "completed";
      current.conclusion = "cancelled";
      current.completedAt = this.store.now();
      for (const job of current.jobs)
        if (job.status !== "completed") {
          job.status = "completed";
          job.conclusion = "cancelled";
          for (const step of job.steps)
            if (step.status !== "completed") {
              step.status = "completed";
              step.conclusion = "cancelled";
            }
        }
    });
    await this.cleanup(result);
    await this.audit(actor, run.repositoryId, "cancel", id);
    return result;
  }
  async approve(actor: Actor, owner: string, name: string, id: string, jobId: string) {
    const run = await this.get(actor, owner, name, id);
    await this.access(actor, owner, name, "admin");
    const job = run.workflow.jobs.find((j) => j.id === jobId);
    if (!job?.environment) throw new ForgeError("Environment job not found", 404, "not_found");
    const environment = await this.store.environment(run.repositoryId, job.environment);
    if (!environment) throw new ForgeError("Environment not found", 404, "not_found");
    const revision = await this.forge.git.resolve(owner, name, environment.branch);
    if (
      run.trigger === "pull_request" ||
      run.ref !== `refs/heads/${environment.branch}` ||
      revision !== run.sha
    )
      throw new ForgeError("Deployment revision is no longer eligible", 409, "stale_head");
    const result = await this.store.update(id, (current) => {
      if (finished(current)) throw new ForgeError("Run has finished", 409, "finished");
      const state = current.jobs.find((j) => j.id === jobId)!;
      if (state.startedAt) throw new ForgeError("Job already started", 409, "running");
      state.approvedBy = actor.userId;
      state.environmentVersion = environment.version;
    });
    await this.audit(actor, run.repositoryId, "approve", `${id}/${jobId}`);
    return result;
  }
  async setEnvironment(actor: Actor, owner: string, name: string, input: unknown) {
    const { repo } = await this.access(actor, owner, name, "admin");
    const value = EnvironmentSchema.parse({ ...(input as object), version: 1 });
    await this.store.setEnvironment(repo.id, value);
    await this.audit(actor, repo.id, "environment", value.name);
    return this.store.environment(repo.id, value.name);
  }
  async setSecret(
    actor: Actor,
    owner: string,
    name: string,
    environment: string,
    key: string,
    value: string | null,
  ) {
    const { repo } = await this.access(actor, owner, name, "admin");
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(key))
      throw new ForgeError("Invalid secret name", 422, "secret");
    if (value !== null && (!value || value.length > 16000))
      throw new ForgeError("Secret must contain 1–16000 characters", 422, "secret");
    if (!(await this.store.environment(repo.id, environment)))
      throw new ForgeError("Environment not found", 404, "not_found");
    const environmentPolicy = await this.store.environment(repo.id, environment);
    await this.store.setEnvironment(repo.id, environmentPolicy!);
    if (value === null) await this.store.deleteSecret(repo.id, environment, key);
    else
      await this.store.setSecret(
        repo.id,
        environment,
        key,
        await encryptSecret(value, this.options.encryptionKey, `${repo.id}:${environment}:${key}`),
      );
    await this.audit(actor, repo.id, "secret", `${environment}/${key}`);
    return { name: key };
  }
  async jobGrant(id: string, jobId: string) {
    const run = await this.store.get(id);
    if (!run || finished(run)) throw new ForgeError("Run is not active", 409, "finished");
    const { settings, actor } = await this.allowed(run.repositoryId);
    const job = run.workflow.jobs.find((j) => j.id === jobId);
    if (!job) throw new ForgeError("Job not found", 404, "not_found");
    const state = run.jobs.find((j) => j.id === jobId)!;
    if (state.startedAt || state.status === "completed")
      throw new ForgeError("Job cannot be replayed", 409, "replay");
    const secrets: Record<string, string> = {};
    if (job.environment) {
      const environment = await this.store.environment(run.repositoryId, job.environment);
      if (!environment) throw new ForgeError("Environment is not configured", 403, "environment");
      const sha = await this.forge.git.resolve(run.owner, run.repo, environment.branch);
      if (
        run.trigger === "pull_request" ||
        run.ref !== `refs/heads/${environment.branch}` ||
        sha !== run.sha
      )
        throw new ForgeError(
          "Deployment requires the current allowed branch revision",
          403,
          "environment",
        );
      if (
        environment.requireApproval &&
        (!state.approvedBy || state.environmentVersion !== environment.version)
      )
        return { ready: false as const, reason: "approval" };
      if (state.approvedBy)
        await this.forge.requireRepo(
          await this.forge.actorFromUser(state.approvedBy),
          run.owner,
          run.repo,
          "admin",
        );
      for (const secret of await this.store.secretRows(run.repositoryId, environment.name))
        secrets[secret.name] = await decryptSecret(
          secret.encrypted,
          this.options.encryptionKey,
          `${run.repositoryId}:${environment.name}:${secret.name}`,
        );
    }
    if (!(await this.store.acquire(run, jobId, settings.concurrency, job.environment)))
      return { ready: false as const, reason: "capacity" };
    try {
      const token = await this.readCredential(run, actor, job.timeoutMinutes + 10, jobId);
      const deploymentId = job.environment
        ? await this.store.beginDeployment(run, jobId, job.environment)
        : undefined;
      return {
        ready: true as const,
        token: token.plaintext,
        tokenId: token.token.id,
        secrets,
        deploymentId,
      };
    } catch (error) {
      await this.store.release(id, jobId);
      throw error;
    }
  }
  async readCredential(run: ActionRun, actor: Actor, minutes: number, label: string) {
    const token = await this.forge.createToken(actor, {
      name: `Actions ${run.id} ${label}`,
      scopes: ["repo:read"],
      repositoryIds: [run.repositoryId],
      kind: "machine",
      expiresAt: this.store.now() + minutes * 60000,
    });
    try {
      await this.store.update(run.id, (current) => {
        if (current.cancelRequested || (label !== "healing" && finished(current)))
          throw new ForgeError("Run stopped", 409, "finished");
        current.credentialIds = [...(current.credentialIds ?? []), token.token.id];
        current.credentialOwners = { ...current.credentialOwners, [token.token.id]: actor.userId };
      });
    } catch (error) {
      await this.forge.store.revokeToken(token.token.id, actor.userId, this.store.now());
      throw error;
    }
    return token;
  }
  async revokeCredentials(run: ActionRun) {
    for (const [id, owner] of Object.entries(run.credentialOwners ?? {}))
      await this.forge.store.revokeToken(id, owner, this.store.now());
  }
  async cleanup(run: ActionRun) {
    await this.store.release(run.id, "__healing");
    await this.revokeCredentials(run);
    for (const job of run.jobs) {
      await this.store.release(run.id, job.id);
      await this.store.finishDeployment(`${run.id}:${job.id}`, job.conclusion ?? "unknown");
    }
  }
  async finish(id: string, error?: string) {
    const updated = await this.store.update(id, (run) => {
      if (finished(run)) return false;
      for (const job of run.jobs)
        if (job.status !== "completed") {
          job.status = "completed";
          job.conclusion = "infrastructure_error";
          job.error = error ?? "Job did not finish";
        }
      run.status = "completed";
      run.conclusion =
        !error && run.jobs.every((j) => j.conclusion === "success") ? "success" : "failure";
      run.completedAt = this.store.now();
      if (error) run.error = error;
    });
    await this.cleanup(updated);
    return updated;
  }
  async recordJob(
    id: string,
    jobId: string,
    change: (state: ActionRun["jobs"][number], run: ActionRun) => void,
  ) {
    return this.store.update(id, (run) => {
      if (finished(run) || run.cancelRequested) return false;
      const state = run.jobs.find((j) => j.id === jobId);
      if (!state) throw new ForgeError("Job not found", 404, "not_found");
      if (state.status === "completed") return false;
      change(state, run);
      run.status = "in_progress";
    });
  }
  async jobFinished(
    id: string,
    jobId: string,
    conclusion: ActionRun["conclusion"],
    error?: string,
  ) {
    const run = await this.recordJob(id, jobId, (state) => {
      state.status = "completed";
      state.conclusion = conclusion;
      state.completedAt = this.store.now();
      if (error) state.error = error;
      for (const step of state.steps)
        if (step.status !== "completed") {
          step.status = "completed";
          step.conclusion = "skipped";
        }
    });
    const state = run.jobs.find((j) => j.id === jobId);
    if (state?.deploymentId)
      await this.store.finishDeployment(state.deploymentId, state.conclusion ?? "unknown");
    await this.store.release(id, jobId);
    return run;
  }
}
export type Actions = ActionsService;
