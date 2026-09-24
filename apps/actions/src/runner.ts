import { getSandbox, streamFile } from "@cloudflare/sandbox";
import type {
  Runner,
  RunStepInput,
  RunStepResult,
  DirectoryBackup,
} from "@cloudflare/ci/worker/source-control";
import { digest, mask, resolveEnv, shellQuote, type StepResult } from "@forgit/actions";
import type { Bindings } from "./env.ts";
import { getRun, GrantSchema, rpc, update } from "./rpc.ts";

import { boundedLogCommand } from "./process.ts";

const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function checkout(
  sandbox: ReturnType<typeof getSandbox>,
  remote: string,
  sha: string,
  token: string,
) {
  const result = await sandbox.exec(
    [
      "mkdir -p /workspace",
      "git init -q /workspace",
      "git -C /workspace config core.hooksPath /dev/null",
      `git -C /workspace remote add origin ${shellQuote(remote)}`,
      `git -c http.extraHeader="Authorization: Bearer $SOURCE_CONTROL_TOKEN" -C /workspace fetch --depth=1 origin ${shellQuote(sha)}`,
      "git -C /workspace checkout --detach FETCH_HEAD",
      `test "$(git -C /workspace rev-parse HEAD)" = ${shellQuote(sha)}`,
    ].join(" && "),
    {
      cwd: "/",
      timeout: 5 * 60000,
      env: {
        SOURCE_CONTROL_TOKEN: token,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    },
  );
  if (result.exitCode !== 0)
    throw new Error(`Checkout failed: ${mask(result.stderr, [token]).slice(-4000)}`);
}
export class ForgitRunner implements Runner<DirectoryBackup> {
  readonly name = "forgit-sandbox";
  constructor(
    private readonly env: Bindings,
    private readonly runId: string,
    private readonly jobId: string,
  ) {}
  async run(input: RunStepInput): Promise<RunStepResult<DirectoryBackup>> {
    const { run } = await getRun(this.env, this.runId);
    const job = run.workflow.jobs.find((j) => j.id === this.jobId);
    if (!job) throw new Error("Job not found");
    const sandboxId = `fg-${await digest(`${this.runId}:${this.jobId}`)}`.slice(0, 63);
    let sandbox: ReturnType<typeof getSandbox> | undefined;
    let sensitive: string[] = [];
    let preview = "";
    try {
      let grant = await rpc(this.env, "grant", this.runId, GrantSchema, undefined, this.jobId);
      const waitingSince = Date.now();
      while (!grant.ready) {
        if (Date.now() - waitingSince > 30 * 60000)
          throw new Error(`Timed out waiting for ${grant.reason}`);
        await pause(5000);
        grant = await rpc(this.env, "grant", this.runId, GrantSchema, undefined, this.jobId);
      }
      sensitive = [grant.token, ...Object.values(grant.secrets)];
      await update(
        this.env,
        "job-start",
        this.runId,
        { sandboxId, deploymentId: grant.deploymentId },
        this.jobId,
      );
      sandbox = getSandbox(this.env.SANDBOX, sandboxId, {
        transport: "rpc",
        enableDefaultSession: false,
      });
      // A deterministic identity lets cancellation/recovery find the Sandbox.
      // No retry of a job is allowed to reuse its side effects.
      if (input.source.kind !== "git") throw new Error("Forgit requires Git checkout");
      await checkout(sandbox, input.source.remote, run.sha, grant.token);
      const deadline = Date.now() + job.timeoutMinutes * 60000;
      const context = {
        sha: run.sha,
        ref: run.ref,
        repository: `${run.owner}/${run.repo}`,
        run_id: run.id,
      };
      for (const definition of job.steps) {
        if ((await getRun(this.env, this.runId)).run.status === "completed")
          throw new Error("Run cancelled");
        const state: StepResult = {
          id: definition.id,
          name: definition.name,
          command: definition.run,
          status: "in_progress",
          conclusion: null,
          startedAt: Date.now(),
          logKey: `runs/${run.id}/${job.id}/${definition.id}.log`,
        };
        await update(this.env, "step", this.runId, state, this.jobId);
        const scriptPath = `/tmp/forgit-${definition.id}.sh`,
          logPath = `/tmp/forgit-${definition.id}.log`;
        await sandbox.writeFile(scriptPath, definition.run);
        const cwdResult = await sandbox.exec(
          `realpath -e ${shellQuote(`/workspace/${definition.cwd}`)}`,
          { cwd: "/" },
        );
        const cwd = cwdResult.stdout.trim();
        if (cwdResult.exitCode !== 0 || (cwd !== "/workspace" && !cwd.startsWith("/workspace/")))
          throw new Error("Working directory escapes the checkout or does not exist");
        const process = await sandbox.startProcess(
          boundedLogCommand(
            `bash --noprofile --norc -e -o pipefail ${shellQuote(scriptPath)}`,
            logPath,
            MAX_LOG_BYTES +
              Math.max(1, ...sensitive.map((value) => new TextEncoder().encode(value).length)) +
              1,
          ),
          {
            cwd,
            env: {
              CI: "true",
              FORGIT_SHA: run.sha,
              FORGIT_REF: run.ref,
              FORGIT_RUN_ID: run.id,
              ...resolveEnv({ ...job.env, ...definition.env }, context, grant.secrets),
            },
            autoCleanup: false,
          },
        );
        const flush = async () => {
          const output = await sandbox!.exec(
            `head -c ${MAX_LOG_BYTES + Math.max(1, ...sensitive.map((value) => new TextEncoder().encode(value).length)) + 1} ${shellQuote(logPath)}`,
            { cwd: "/", timeout: 30000 },
          );
          const raw = output.stdout;
          const truncated = new TextEncoder().encode(raw).length > MAX_LOG_BYTES;
          const safe =
            new TextDecoder().decode(
              new TextEncoder().encode(mask(raw, sensitive)).slice(0, MAX_LOG_BYTES),
            ) + (truncated ? "\n[Log limit reached]\n" : "");
          await this.env.BACKUP_BUCKET.put(state.logKey!, safe, {
            httpMetadata: { contentType: "text/plain; charset=utf-8" },
          });
          state.logBytes = new TextEncoder().encode(safe).length;
          state.logTruncated = truncated;
          preview = safe.slice(-20000);
          await update(this.env, "step", this.runId, state, this.jobId);
          return truncated;
        };
        let done = false;
        while (!done) {
          const status = await process.getStatus();
          done = !["starting", "running"].includes(status);
          const truncated = await flush();
          if (
            truncated ||
            Date.now() > deadline ||
            (await getRun(this.env, this.runId)).run.status === "completed"
          ) {
            await process.kill("SIGKILL").catch(() => {});
            state.status = "completed";
            state.conclusion = truncated
              ? "failure"
              : Date.now() > deadline
                ? "timed_out"
                : "cancelled";
            state.exitCode = 137;
            state.completedAt = Date.now();
            await update(this.env, "step", this.runId, state, this.jobId);
            await update(
              this.env,
              "job-finish",
              this.runId,
              {
                conclusion: state.conclusion,
                error: truncated ? "Log size limit exceeded" : state.conclusion,
              },
              this.jobId,
            );
            return {
              exitCode: 137,
              logs: { stdout: preview, stderr: "" },
              preview: { stdout: preview, stderr: "" },
            };
          }
          if (!done) await pause(2000);
        }
        const result = await process.waitForExit(1000);
        await flush();
        state.status = "completed";
        state.exitCode = result.exitCode;
        state.conclusion = result.exitCode === 0 ? "success" : "failure";
        state.completedAt = Date.now();
        await update(this.env, "step", this.runId, state, this.jobId);
        if (result.exitCode !== 0) {
          await update(
            this.env,
            "job-finish",
            this.runId,
            { conclusion: "failure", error: `${definition.name} exited ${result.exitCode}` },
            this.jobId,
          );
          return {
            exitCode: result.exitCode,
            logs: { stdout: preview, stderr: "" },
            preview: { stdout: preview, stderr: "" },
          };
        }
      }
      for (const path of job.artifacts) {
        const resolved = await sandbox.exec(`realpath -e ${shellQuote(`/workspace/${path}`)}`, {
          cwd: "/",
        });
        const file = resolved.stdout.trim();
        if (resolved.exitCode !== 0 || !file.startsWith("/workspace/") || file.includes("/.git/"))
          throw new Error("Artifact is outside the checkout or missing");
        const stat = await sandbox.exec(
          `test -f ${shellQuote(file)} && stat -c %s ${shellQuote(file)}`,
          { cwd: "/" },
        );
        const bytes = Number(stat.stdout.trim());
        if (stat.exitCode !== 0 || !Number.isSafeInteger(bytes) || bytes > MAX_ARTIFACT_BYTES)
          throw new Error("Artifact must be a file smaller than 32 MiB");
        const key = `runs/${run.id}/${job.id}/artifacts/${path}`;
        const hash = await sandbox.exec(`sha256sum ${shellQuote(file)}`, { cwd: "/" });
        const stream = new FixedLengthStream(bytes);
        const upload = (async () => {
          const writer = stream.writable.getWriter();
          try {
            for await (const chunk of streamFile(await sandbox!.readFileStream(file)))
              await writer.write(
                typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
              );
            await writer.close();
          } catch (error) {
            await writer.abort(error);
            throw error;
          } finally {
            writer.releaseLock();
          }
        })();
        await Promise.all([
          upload,
          this.env.BACKUP_BUCKET.put(key, stream.readable, { sha256: hash.stdout.split(" ")[0]! }),
        ]);
        await update(
          this.env,
          "artifact",
          this.runId,
          {
            name: `${job.id}/${path}`,
            key,
            bytes,
            digest: hash.stdout.split(" ")[0]!,
            jobId: job.id,
          },
          this.jobId,
        );
      }
      // Cloudflare CI owns the durable snapshot contract; one snapshot per job.
      const localBucket = this.env.ACTIONS_LOCAL === "true";
      const snapshot = await sandbox.createBackup({
        dir: "/workspace",
        name: `${this.runId}-${this.jobId}`,
        ttl: 3600,
        multipart: true,
        localBucket,
      });
      await update(this.env, "job-finish", this.runId, { conclusion: "success" }, this.jobId);
      return {
        exitCode: 0,
        logs: { stdout: preview, stderr: "" },
        preview: { stdout: preview, stderr: "" },
        snapshot,
      };
    } catch (error) {
      const message = mask(
        error instanceof Error ? error.message : "Runner failed",
        sensitive,
      ).slice(0, 20000);
      await update(
        this.env,
        "job-finish",
        this.runId,
        { conclusion: "infrastructure_error", error: message },
        this.jobId,
      );
      throw new Error(message);
    } finally {
      if (sandbox) await sandbox.destroy();
    }
  }
}
