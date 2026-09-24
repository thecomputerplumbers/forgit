/** Run with `pnpm exec tsx tests/actions/smoke.ts`. Requires Docker. No cloud credentials. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { ActionsService, ActionsStore, internalAction } from "../../packages/actions/src/index.ts";
import { createSqlStore, type Sql } from "../../packages/db/src/sql-store.ts";
import { createServices, ForgeError } from "../../packages/domain/src/index.ts";
import { MemoryGit } from "../../packages/git-client/src/index.ts";

async function main() {
  const root = resolve(import.meta.dirname, "../.."),
    temp = mkdtempSync(join(tmpdir(), "forgit-actions-smoke-")),
    repoPath = join(temp, "acme", "fixture.git");
  mkdirSync(repoPath, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  git("init", "-q", "-b", "main");
  git("config", "core.hooksPath", "/dev/null");
  git("config", "commit.gpgsign", "false");
  git("config", "user.name", "Smoke");
  git("config", "user.email", "smoke@example.test");
  git("config", "http.receivepack", "false");
  mkdirSync(join(repoPath, "src"));
  mkdirSync(join(repoPath, ".forgit", "workflows"), { recursive: true });
  const yaml = `name: Smoke\non: [push, pull_request, workflow_dispatch]\njobs:\n  test:\n    runs-on: node-26\n    artifacts: [result.txt]\n    steps:\n      - run: node --input-type=module -e 'import v from "./src/value.mjs"; if(v!==2)throw new Error("expected 2"); console.log("verified");'\n      - run: printf artifact > result.txt\n`;
  writeFileSync(join(repoPath, "src/value.mjs"), "export default 1;\n");
  writeFileSync(join(repoPath, ".forgit/workflows/ci.yml"), yaml);
  git("add", ".");
  git("commit", "-qm", "broken fixture");
  const db = new DatabaseSync(join(temp, "metadata.sqlite"));
  for (const file of ["0001_init.sql", "0002_sso_provider.sql", "0003_actions.sql"])
    db.exec(readFileSync(join(root, "apps/web/migrations", file), "utf8"));
  db.exec(
    "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES('alice','Alice','alice@example.test',1,1,1); INSERT INTO organization(id,name,slug,created_at) VALUES('org','Acme','acme',1); INSERT INTO member(id,organization_id,user_id,role,created_at) VALUES('m','org','alice','owner',1);",
  );
  const sql: Sql = {
    async all(q, p = []) {
      return db.prepare(q).all(...p) as never;
    },
    async run(q, p = []) {
      return { changes: Number(db.prepare(q).run(...p).changes) };
    },
  };
  const memory = new MemoryGit("http://localhost"),
    store = createSqlStore(sql);
  const client = new Proxy(memory, {
    get(target, key) {
      if (key === "resolve")
        return async (_o: string, _r: string, ref: string) => {
          try {
            return git("rev-parse", `${ref}^{commit}`);
          } catch {
            return null;
          }
        };
      if (key === "blob")
        return async (_o: string, _r: string, ref: string, path: string) => {
          try {
            const contents = git("show", `${ref}:${path}`);
            return {
              ref,
              path,
              name: path.split("/").at(-1),
              sha: git("rev-parse", `${ref}:${path}`),
              size: contents.length,
              contents,
              binary: false,
            };
          } catch {
            return null;
          }
        };
      if (key === "tree")
        return async (_o: string, _r: string, ref: string, path: string) => {
          try {
            return {
              entries: git("ls-tree", `${ref}${path ? `:${path}` : ""}`)
                .split("\n")
                .map((line) => {
                  const [mode, type, sha, name] = line.split(/[\t ]/);
                  return { mode, type, sha, name };
                }),
            };
          } catch {
            return null;
          }
        };
      if (key === "createBranch")
        return async (input: { branch: string; fromRef: string }) => {
          git("branch", input.branch, input.fromRef);
          return { sha: git("rev-parse", input.branch) };
        };
      if (key === "writeFile")
        return async (input: {
          branch: string;
          path: string;
          contents: string;
          message: string;
        }) => {
          assert.ok(input.branch.startsWith("actions/fix/"));
          git("checkout", "-q", input.branch);
          writeFileSync(join(repoPath, input.path), input.contents);
          git("add", "--", input.path);
          git("commit", "-qm", input.message);
          return { commitSha: git("rev-parse", "HEAD") };
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const forge = createServices(store, client, "http://localhost");
  await store.upsertLogin("alice", "alice", 1);
  const actor = await forge.actorFromUser("alice");
  await forge.createRepository(actor, { owner: "acme", name: "fixture" });
  const actions = new ActionsService(new ActionsStore(sql), forge, {
    enabled: true,
    forActor: () => forge,
  });
  await actions.configure(actor, "acme", "fixture", { enabled: true, healing: "repair" });
  const run = await actions.manual(actor, "acme", "fixture", {
    workflow: ".forgit/workflows/ci.yml",
    ref: "main",
  });
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/api/actions/internal") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const output = await internalAction(actions, JSON.parse(Buffer.concat(chunks).toString()));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(output));
        return;
      }
      const url = new URL(req.url!, "http://localhost");
      const child = spawn("git", ["http-backend"], {
        env: {
          ...process.env,
          GIT_PROJECT_ROOT: temp,
          GIT_HTTP_EXPORT_ALL: "1",
          PATH_INFO: url.pathname,
          QUERY_STRING: url.search.slice(1),
          REQUEST_METHOD: req.method,
          CONTENT_TYPE: req.headers["content-type"] ?? "",
          CONTENT_LENGTH: req.headers["content-length"] ?? "",
          GIT_PROTOCOL: String(req.headers["git-protocol"] ?? ""),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      req.pipe(child.stdin);
      const chunks: Buffer[] = [];
      for await (const chunk of child.stdout) chunks.push(Buffer.from(chunk));
      const output = Buffer.concat(chunks),
        boundary = output.indexOf("\r\n\r\n");
      if (boundary < 0) throw new Error("Invalid git backend response");
      let status = 200;
      const headers: Record<string, string> = {};
      for (const line of output.subarray(0, boundary).toString().split("\r\n")) {
        const colon = line.indexOf(":");
        const key = line.slice(0, colon),
          value = line.slice(colon + 1).trim();
        if (key.toLowerCase() === "status") status = Number(value.split(" ")[0]);
        else headers[key] = value;
      }
      res.writeHead(status, headers);
      res.end(output.subarray(boundary + 4));
    } catch (error) {
      res.writeHead(error instanceof ForgeError ? error.status : 500, {
        "content-type": "application/json",
      });
      res.end(
        JSON.stringify({ message: error instanceof Error ? error.message : "fixture failed" }),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(4881, "0.0.0.0", resolve));
  const workerName = `forgit-actions-smoke-${temp.split("-").at(-1)!.toLowerCase()}`;
  const config = {
    name: workerName,
    main: join(root, "tests/actions/worker.ts"),
    compatibility_date: "2026-09-23",
    compatibility_flags: ["nodejs_compat"],
    vars: {
      FORGIT_ORIGIN: "http://host.docker.internal:4881",
      ACTIONS_INTERNAL_TOKEN: "local-fixture-only",
      BACKUP_BUCKET_NAME: "smoke",
      ACTIONS_LOCAL: "true",
      CLOUDFLARE_ACCOUNT_ID: "local",
    },
    services: [{ binding: "FORGIT", service: "forgit-actions-proxy" }],
    workflows: [{ binding: "CI_WORKFLOW", name: "actions-smoke", class_name: "SmokeWorkflow" }],
    durable_objects: { bindings: [{ name: "SANDBOX", class_name: "CiSandbox" }] },
    migrations: [{ tag: "v1", new_sqlite_classes: ["CiSandbox"] }],
    containers: [
      {
        class_name: "CiSandbox",
        image: join(root, "apps/actions/Dockerfile"),
        image_build_context: join(root, "apps/actions"),
        max_instances: 4,
      },
    ],
    r2_buckets: [{ binding: "BACKUP_BUCKET", bucket_name: "smoke" }],
  };
  writeFileSync(join(temp, "wrangler.json"), JSON.stringify(config));
  writeFileSync(
    join(temp, "proxy.json"),
    JSON.stringify({
      name: "forgit-actions-proxy",
      main: join(root, "tests/actions/proxy.ts"),
      compatibility_date: "2026-09-23",
      vars: { FIXTURE_ORIGIN: "http://127.0.0.1:4881" },
    }),
  );
  const wrangler = spawn(
    process.execPath,
    [
      join(root, "apps/actions/node_modules/wrangler/bin/wrangler.js"),
      "dev",
      "--config",
      join(temp, "wrangler.json"),
      "--config",
      join(temp, "proxy.json"),
      "--port",
      "4882",
      "--persist-to",
      join(temp, "state"),
    ],
    {
      cwd: root,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
  const output: string[] = [];
  wrangler.stdout.on("data", (b) => output.push(String(b)));
  wrangler.stderr.on("data", (b) => output.push(String(b)));
  try {
    for (let i = 0; i < 180; i++) {
      try {
        await fetch("http://127.0.0.1:4882", { signal: AbortSignal.timeout(1000) });
        break;
      } catch {
        if (wrangler.exitCode !== null) throw new Error("Wrangler exited");
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    console.log("Starting smoke workflow");
    const response = await fetch("http://127.0.0.1:4882", {
      signal: AbortSignal.timeout(15000),
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(run),
    });
    assert.equal(response.status, 200, await response.text());
    console.log("Workflow accepted; waiting for repair");
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const result = await actions.store.get(run.id);
      if (["proposed", "failed", "diagnosed"].includes(result?.healing?.status ?? "")) {
        assert.equal(result?.healing?.status, "proposed", JSON.stringify(result));
        assert.equal(result?.conclusion, "failure");
        assert.ok(result.healing.pullNumber);
        assert.equal(git("show", `${result.healing.branch}:src/value.mjs`), "export default 2;");
        assert.equal(git("show", "main:src/value.mjs"), "export default 1;");
        console.log(
          "PASS: real Workflow + Sandbox failure, fresh verification, repair branch and PR; original failure and main preserved.",
        );
        break;
      }
      if (Date.now() + 1000 >= deadline)
        throw new Error(`Workflow timed out: ${JSON.stringify(result)}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    const repaired = await actions.store.get(run.id);
    assert.equal(repaired?.healing?.status, "proposed", "Repair did not finish before deadline");
    const next = await actions.manual(actor, "acme", "fixture", {
      workflow: ".forgit/workflows/ci.yml",
      ref: repaired!.healing!.branch!,
    });
    const startNext = await fetch("http://127.0.0.1:4882", {
      method: "POST",
      body: JSON.stringify(next),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(startNext.status, 200, await startNext.text());
    for (let i = 0; i < 90; i++) {
      const result = await actions.store.get(next.id);
      if (result?.status === "completed") break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const success = await actions.store.get(next.id);
    assert.equal(success?.conclusion, "success", JSON.stringify(success));
    assert.equal(success.artifacts.length, 1);
    const log = await fetch("http://127.0.0.1:4882/log", {
      method: "POST",
      body: JSON.stringify({ key: success.jobs[0]!.steps[0]!.logKey }),
    });
    assert.match(await log.text(), /verified/);
    console.log(
      "PASS: repaired commit executes successfully, persists logs and artifacts, and snapshots through Cloudflare CI.",
    );
    git("checkout", "-qb", "cancel-fixture", repaired!.healing!.branch!);
    writeFileSync(
      join(repoPath, ".forgit/workflows/ci.yml"),
      yaml.replace(/run: node[^\n]+/, "run: sleep 120"),
    );
    git("add", ".");
    git("commit", "-qm", "cancellation fixture");
    const cancelRun = await actions.manual(actor, "acme", "fixture", {
      workflow: ".forgit/workflows/ci.yml",
      ref: "cancel-fixture",
    });
    const startCancel = await fetch("http://127.0.0.1:4882", {
      method: "POST",
      body: JSON.stringify(cancelRun),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(startCancel.status, 200, await startCancel.text());
    for (let i = 0; i < 30; i++) {
      if ((await actions.store.get(cancelRun.id))?.jobs[0]?.steps[0]?.startedAt) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.ok((await actions.store.get(cancelRun.id))?.jobs[0]?.startedAt);
    await actions.cancel(actor, "acme", "fixture", cancelRun.id);
    const cancelled = await fetch(`http://127.0.0.1:4882/cancel/${cancelRun.id}`, {
      method: "POST",
      headers: { authorization: "Bearer local-fixture-only" },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(cancelled.status, 200, await cancelled.text());
    assert.equal((await actions.store.get(cancelRun.id))?.conclusion, "cancelled");
    console.log("PASS: cancellation destroys the running Sandbox and preserves cancelled status.");
  } catch (error) {
    console.error(output.join("").slice(-20000));
    throw error;
  } finally {
    try {
      process.kill(-wrangler.pid!, "SIGTERM");
    } catch {
      /* Already exited. */
    }
    server.closeAllConnections();
    server.close();
    if (wrangler.exitCode === null)
      await Promise.race([
        new Promise((r) => wrangler.once("exit", r)),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
    const containers = execFileSync(
      "docker",
      ["ps", "-aq", "--filter", `name=workerd-${workerName}-`],
      { encoding: "utf8" },
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (containers.length) execFileSync("docker", ["rm", "-f", ...containers], { stdio: "ignore" });
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
