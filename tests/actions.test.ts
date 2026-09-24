import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import {
  ActionsService,
  ActionsStore,
  parseWorkflow,
  matchesWorkflow,
  verifyEvent,
  encryptSecret,
  decryptSecret,
  workflowCheck,
  safeRepairPath,
  healingGrant,
  publishRepair,
  actionHttpOperation,
} from "../packages/actions/src/index.ts";
import { createSqlStore, type Sql } from "@forgit/db/sql-store";
import { createServices, evaluateMergePolicy } from "@forgit/domain";
import { MemoryGit } from "@forgit/git-client";
import { signBody } from "@forgit/auth/crypto";
import { BILLING_PLANS } from "../apps/web/lib/billing-plans.ts";

const YAML = `name: CI
on: [push, pull_request, workflow_dispatch]
jobs:
  test:
    runs-on: node-26
    steps:
      - name: Test
        run: pnpm test
`;
async function fixture() {
  const db = new DatabaseSync(":memory:");
  for (const file of [
    "0001_init.sql",
    "0002_sso_provider.sql",
    "0004_actions.sql",
    "0005_billing.sql",
    "0006_billing_delivery.sql",
  ])
    db.exec(readFileSync(new URL(`../apps/web/migrations/${file}`, import.meta.url), "utf8"));
  for (const id of ["alice", "bob", "cara"])
    db.prepare(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,1,1)",
    ).run(id, id, `${id}@example.com`);
  db.prepare(
    "INSERT INTO organization(id,name,slug,created_at) VALUES('org','Acme','acme',1)",
  ).run();
  db.prepare(
    "INSERT INTO member(id,organization_id,user_id,role,created_at) VALUES('m','org','alice','owner',1)",
  ).run();
  const sql: Sql = {
    async all(query, params = []) {
      return db.prepare(query).all(...params) as never;
    },
    async run(query, params = []) {
      return { changes: Number(db.prepare(query).run(...params).changes) };
    },
  };
  const store = createSqlStore(sql),
    git = new MemoryGit("https://git.example.com"),
    forge = createServices(store, git, "https://git.example.com");
  for (const id of ["alice", "bob", "cara"]) await store.upsertLogin(id, id, 1);
  const alice = await forge.actorFromUser("alice"),
    bob = await forge.actorFromUser("bob"),
    cara = await forge.actorFromUser("cara");
  const { repo } = await forge.createRepository(alice, { owner: "acme", name: "widget" });
  await store.upsertRepoMember({ repositoryId: repo.id, userId: "bob", role: "write" });
  const base = git.commitFiles({
    owner: "acme",
    repo: "widget",
    branch: "main",
    message: "initial",
    files: { ".forgit/workflows/ci.yml": YAML, "src/app.ts": "broken" },
  });
  await git.createBranch({ owner: "acme", repo: "widget", branch: "develop", fromRef: "main" });
  const actions = new ActionsService(new ActionsStore(sql), forge, {
    enabled: true,
    encryptionKey: "ab".repeat(32),
    forActor: () => forge,
  });
  await actions.configure(alice, "acme", "widget", { enabled: true });
  return { db, sql, store, git, forge, actions, alice, bob, cara, repo, base };
}
describe("Actions workflow contract", () => {
  it("accepts familiar YAML and rejects ambiguous or unsafe definitions", () => {
    const workflow = parseWorkflow(YAML);
    assert.equal(workflow.jobs[0]?.steps[0]?.run, "pnpm test");
    assert.equal(matchesWorkflow(workflow, "push", "refs/heads/main"), true);
    for (const source of [
      YAML.replace("runs-on: node-26", "runs-on: arbitrary-image"),
      YAML.replace("run: pnpm test", "uses: random/action@main"),
      YAML.replace("run: pnpm test", "run: echo ${{ secrets.TOKEN }}"),
      YAML.replace("run: pnpm test", "run: pnpm test\n        working-directory: ../outside"),
      YAML + "name: duplicate\n",
      YAML.replace("steps:", "needs: test\n    steps:"),
    ])
      assert.throws(() => parseWorkflow(source));
  });
  it("matches branch and tag filters independently", () => {
    const workflow = parseWorkflow(
      YAML.replace(
        "on: [push, pull_request, workflow_dispatch]",
        "on:\n  push:\n    branches: [main, 'release/**']",
      ),
    );
    assert.equal(matchesWorkflow(workflow, "push", "refs/heads/release/a/b"), true);
    assert.equal(matchesWorkflow(workflow, "push", "refs/tags/main"), false);
    assert.equal(matchesWorkflow(workflow, "pull_request", "refs/heads/main"), false);
  });
});
describe("Actions authorization and durable state", () => {
  it("records each completed job duration once for its owning organization", async () => {
    const { actions, alice, db, repo } = await fixture();
    assert.equal(BILLING_PLANS.developer.monthlyCents, 100);
    assert.equal(BILLING_PLANS.business.monthlyCents, 5_000);
    assert.equal(BILLING_PLANS.enterprise.monthlyCents, 100_000);
    db.prepare(
      "INSERT INTO billing_accounts(organization_id,plan,status,stripe_customer_id,metronome_customer_id,created_at,updated_at) VALUES('org','developer','active','cus_test','met_test',1,1)",
    ).run();
    const run = await actions.manual(alice, "acme", "widget", {
      workflow: ".forgit/workflows/ci.yml",
      ref: "main",
    });
    await actions.store.update(run.id, (current) => {
      current.jobs[0]!.status = "in_progress";
      current.jobs[0]!.startedAt = 1_000;
    });
    await actions.store.update(run.id, (current) => {
      current.jobs[0]!.status = "completed";
      current.jobs[0]!.conclusion = "failure";
      current.jobs[0]!.completedAt = 2_500;
    });
    await actions.store.update(run.id, (current) => {
      current.error = "late status update";
    });
    const rows = db
      .prepare(
        "SELECT organization_id,repository_id,action_run_id,job_id,quantity,delivered_at FROM billing_usage_events",
      )
      .all() as Record<string, unknown>[];
    assert.deepEqual(
      rows.map((row) => ({ ...row })),
      [
        {
          organization_id: "org",
          repository_id: repo.id,
          action_run_id: run.id,
          job_id: "test",
          quantity: 1_500,
          delivered_at: null,
        },
      ],
    );
  });
  it("does not meter an organization without an active billing account", async () => {
    const { actions, alice, db } = await fixture();
    const run = await actions.manual(alice, "acme", "widget", {
      workflow: ".forgit/workflows/ci.yml",
      ref: "main",
    });
    await actions.store.update(run.id, (current) => {
      current.jobs[0]!.startedAt = 1_000;
      current.jobs[0]!.completedAt = 2_000;
      current.jobs[0]!.status = "completed";
    });
    assert.equal(db.prepare("SELECT count(*) AS total FROM billing_usage_events").get()?.total, 0);
  });
  it("authenticates raw event bodies and validates every ref", async () => {
    const event = {
      repo: "acme/widget",
      action: "update",
      ref_type: "branch",
      ref_name: "refs/heads/main",
      old: "a".repeat(40),
      new: "b".repeat(40),
      pusher: "alice",
      _walgit: { schema_version: 1, seq: "18446744073709551615" },
    };
    const body = JSON.stringify([event]),
      signature = await signBody("secret", body);
    assert.equal((await verifyEvent(body, signature, "secret"))[0]?._walgit.seq, event._walgit.seq);
    await assert.rejects(() => verifyEvent(`${body} `, signature, "secret"));
    const invalid = JSON.stringify([{ ...event, new: "not-a-sha" }]);
    const invalidSignature = await signBody("secret", invalid);
    await assert.rejects(() => verifyEvent(invalid, invalidSignature, "secret"));
  });
  it("deduplicates events and runs while keeping independent attempts", async () => {
    const { actions, alice, repo, base, store } = await fixture();
    const first = await actions.manual(alice, "acme", "widget", {
      workflow: ".forgit/workflows/ci.yml",
      ref: "main",
    });
    const duplicate = await actions.store.create({ ...first, id: crypto.randomUUID() });
    assert.equal(duplicate.id, first.id);
    await actions.store.update(first.id, (r) => {
      r.status = "completed";
      r.conclusion = "success";
      r.completedAt = Date.now();
    });
    const second = await actions.rerun(alice, "acme", "widget", first.id);
    assert.notEqual(second.id, first.id);
    assert.equal(second.sha, first.sha);
    // The previous successful attempt updates late, after the rerun is queued.
    await actions.store.update(first.id, (r) => {
      r.error = "late message";
    });
    const checks = await store.listChecks(repo.id, base);
    const current = checks.find((c) => c.name === workflowCheck(first.workflowPath, first.trigger));
    assert.equal(current?.status, "queued");
    assert.equal(current?.actionRunId, second.id);
    await actions.cancel(alice, "acme", "widget", second.id);
    await actions.recordJob(second.id, "test", (job) => {
      job.status = "completed";
      job.conclusion = "success";
    });
    assert.equal((await actions.store.get(second.id))?.conclusion, "cancelled");
  });
  it("never accepts a forged Actions check or an out-of-repository run", async () => {
    const { actions, alice, bob, cara, forge, repo, base } = await fixture();
    const run = await actions.manual(alice, "acme", "widget", {
      workflow: ".forgit/workflows/ci.yml",
      ref: "main",
    });
    await assert.rejects(() => actions.get(cara, "acme", "widget", run.id));
    await assert.rejects(() => actions.configure(bob, "acme", "widget", { healing: "repair" }));
    await assert.rejects(() =>
      forge.recordCheck(alice, "acme", "widget", {
        name: workflowCheck(run.workflowPath, run.trigger),
        headSha: base,
        status: "completed",
        conclusion: "success",
      }),
    );
    const policy = evaluateMergePolicy(
      {
        repositoryId: repo.id,
        requiredApprovals: 0,
        requiredChecks: ["actions/ci.yml/push"],
        dismissStaleReviews: true,
      },
      { headSha: base, authorId: "alice" },
      [],
      [
        {
          id: "fake",
          repositoryId: repo.id,
          name: "actions/ci.yml/push",
          headSha: base,
          status: "completed",
          conclusion: "success",
          title: "",
          summary: "",
          startedAt: 1,
          completedAt: 2,
        },
      ],
    );
    assert.equal(policy.checks[0]?.state, "missing");
  });
  it("allows a checks-only token to report external checks without Git write", async () => {
    const { forge, alice, repo, base } = await fixture();
    const token = await forge.createToken(alice, {
      name: "checks",
      scopes: ["repo:read", "checks:write"],
      repositoryIds: [repo.id],
    });
    const actor = (await forge.actorFromAuthorization(`Bearer ${token.plaintext}`))!;
    await forge.recordCheck(actor, "acme", "widget", {
      name: "external/test",
      headSha: base,
      status: "completed",
      conclusion: "success",
    });
    await assert.rejects(() => forge.requireRepo(actor, "acme", "widget", "write"));
  });
  it("keeps secrets bound to the repository and environment", async () => {
    const key = "ab".repeat(32),
      encrypted = await encryptSecret("value", key, "repo:prod:TOKEN");
    assert.equal(await decryptSecret(encrypted, key, "repo:prod:TOKEN"), "value");
    await assert.rejects(() => decryptSecret(encrypted, key, "other:prod:TOKEN"));
    const { actions, alice } = await fixture();
    await actions.setEnvironment(alice, "acme", "widget", {
      name: "production",
      branch: "main",
      requireApproval: true,
    });
    await actions.setSecret(alice, "acme", "widget", "production", "TOKEN", "secret");
    const rows = await actions.store.secretRows(
      (await actions.access(alice, "acme", "widget")).repo.id,
      "production",
    );
    assert.ok(!rows[0]?.encrypted.includes("secret"));
  });
  it("constrains repair proposals independently of the agent prompt", () => {
    assert.equal(safeRepairPath("src/app.ts"), true);
    for (const path of [
      "../outside",
      ".forgit/workflows/ci.yml",
      "package.json",
      "packages/a/package.json",
      "tests/test.ts",
      "src/app.test.ts",
      ".git/config",
      "tsconfig.json",
    ])
      assert.equal(safeRepairPath(path), false, path);
  });
});

describe("Actions execution and deployment boundaries", () => {
  it("receipts deduplicate a replayed signed push and pin the accepted SHA", async () => {
    const { actions, base, git, repo } = await fixture();
    const event = {
      repo: "acme/widget",
      action: "update" as const,
      ref_type: "branch" as const,
      ref_name: "refs/heads/develop",
      old: "a".repeat(40),
      new: base,
      pusher: "alice",
      _walgit: { schema_version: 1 as const, seq: "1" },
    };
    await actions.receive([event, event]);
    git.commitFiles({
      owner: "acme",
      repo: "widget",
      branch: "develop",
      message: "advance",
      files: { "src/app.ts": "next" },
    });
    await actions.processEvents();
    await actions.receive([event]);
    await actions.processEvents();
    const runs = await actions.store.list(repo.id);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.sha, base);
  });
  it("revokes checkout credentials after cancellation even if the configured user changes", async () => {
    const { actions, alice, cara, store, repo, forge } = await fixture();
    const run = await actions.manual(alice, "acme", "widget", {
      workflow: ".forgit/workflows/ci.yml",
      ref: "develop",
    });
    const grant = await actions.jobGrant(run.id, "test");
    assert.equal(grant.ready, true);
    if (!grant.ready) return;
    const tokenActor = await forge.actorFromAuthorization(`Bearer ${grant.token}`);
    assert.deepEqual(tokenActor?.tokenScopes, ["repo:read"]);
    assert.deepEqual(tokenActor?.repositoryIds, [repo.id]);
    await store.upsertRepoMember({ repositoryId: repo.id, userId: cara.userId, role: "admin" });
    await actions.configure(cara, "acme", "widget", { enabled: true });
    await actions.cancel(alice, "acme", "widget", run.id);
    assert.equal(
      (await store.listTokens(alice.userId)).find((t) => t.id === grant.tokenId)?.revokedAt !==
        null,
      true,
    );
    assert.equal((await actions.store.sql.all("SELECT * FROM action_leases")).length, 0);
    await assert.rejects(() => actions.jobGrant(run.id, "test"));
  });
  it("fails closed on job replay and preserves deployment results after cancellation", async () => {
    const { actions, alice } = await fixture();
    const run = await actions.manual(alice, "acme", "widget", {
      workflow: ".forgit/workflows/ci.yml",
      ref: "develop",
    });
    await actions.recordJob(run.id, "test", (job) => {
      job.status = "in_progress";
      job.startedAt = Date.now();
    });
    await assert.rejects(() => actions.jobGrant(run.id, "test"), /replayed/);
    await actions.cancel(alice, "acme", "widget", run.id);
    await actions.jobFinished(run.id, "test", "success");
    assert.equal((await actions.store.get(run.id))?.jobs[0]?.conclusion, "cancelled");
  });
  it("invalidates approval when environment policy changes and rejects stale deployment SHAs", async () => {
    const { actions, alice, git } = await fixture();
    git.commitFiles({
      owner: "acme",
      repo: "widget",
      branch: "develop",
      message: "deployment",
      files: {
        ".forgit/workflows/ci.yml": YAML.replace(
          "runs-on: node-26",
          "runs-on: node-26\n    environment: production",
        ),
      },
    });
    await actions.setEnvironment(alice, "acme", "widget", {
      name: "production",
      branch: "develop",
      requireApproval: true,
    });
    await actions.setSecret(alice, "acme", "widget", "production", "DEPLOY_TOKEN", "private-value");
    const run = await actions.manual(alice, "acme", "widget", {
      workflow: ".forgit/workflows/ci.yml",
      ref: "develop",
    });
    assert.deepEqual(await actions.jobGrant(run.id, "test"), { ready: false, reason: "approval" });
    await actions.approve(alice, "acme", "widget", run.id, "test");
    await actions.setEnvironment(alice, "acme", "widget", {
      name: "production",
      branch: "develop",
      requireApproval: true,
    });
    assert.deepEqual(await actions.jobGrant(run.id, "test"), { ready: false, reason: "approval" });
    await actions.approve(alice, "acme", "widget", run.id, "test");
    git.commitFiles({
      owner: "acme",
      repo: "widget",
      branch: "develop",
      message: "advanced",
      files: { "src/app.ts": "new" },
    });
    await assert.rejects(() => actions.jobGrant(run.id, "test"), /current allowed branch/);
    assert.equal((await actions.store.sql.all("SELECT * FROM action_leases")).length, 0);
  });
  it("never releases environment secrets to pull request workflows", async () => {
    const { actions, alice, git, repo } = await fixture();
    const sha = git.commitFiles({
      owner: "acme",
      repo: "widget",
      branch: "develop",
      message: "deployment",
      files: {
        ".forgit/workflows/ci.yml": YAML.replace(
          "runs-on: node-26",
          "runs-on: node-26\n    environment: production",
        ),
      },
    });
    await actions.setEnvironment(alice, "acme", "widget", {
      name: "production",
      branch: "develop",
      requireApproval: false,
    });
    const run = await actions.makeRun({
      repositoryId: repo.id,
      owner: "acme",
      name: "widget",
      path: ".forgit/workflows/ci.yml",
      sha,
      ref: "refs/heads/develop",
      trigger: "pull_request",
      actorId: alice.userId,
      eventKey: "pr-test",
    });
    await assert.rejects(() => actions.jobGrant(run!.id, "test"), /current allowed branch/);
  });
  it("limits concurrent jobs atomically and serializes each environment", async () => {
    const { actions, alice } = await fixture();
    const run = await actions.manual(alice, "acme", "widget", {
      workflow: ".forgit/workflows/ci.yml",
      ref: "develop",
    });
    const admitted = await Promise.all(
      ["a", "b", "c"].map((id) => actions.store.acquire(run, id, 2)),
    );
    assert.equal(admitted.filter(Boolean).length, 2);
    await actions.store.release(run.id, "a");
    await actions.store.release(run.id, "b");
    assert.equal(await actions.store.acquire(run, "first", 4, "production"), true);
    assert.equal(await actions.store.acquire(run, "second", 4, "production"), false);
  });
});

describe("Actions repair publication policy", () => {
  it("publishes a separate proposal without changing the failed check or protected branch", async () => {
    const { actions, alice, git, base, repo, store } = await fixture();
    await actions.configure(alice, "acme", "widget", { healing: "repair" });
    const run = await actions.manual(alice, "acme", "widget", {
      workflow: ".forgit/workflows/ci.yml",
      ref: "main",
    });
    await actions.jobFinished(run.id, "test", "failure");
    await actions.finish(run.id);
    await healingGrant(actions, run.id);
    await assert.rejects(
      () =>
        publishRepair(actions, run.id, {
          summary: "Weaken tests",
          edits: [{ path: "tests/check.ts", contents: "" }],
        }),
      /protected/,
    );
    const repaired = await publishRepair(actions, run.id, {
      summary: "Fix the implementation",
      edits: [{ path: "src/app.ts", contents: "fixed" }],
    });
    assert.equal(repaired.conclusion, "failure");
    assert.equal(repaired.healing?.status, "proposed");
    assert.ok(repaired.healing?.pullNumber);
    assert.equal(await git.resolve("acme", "widget", "main"), base);
    assert.equal((await store.listChecks(repo.id, base))[0]?.conclusion, "failure");
    const duplicate = await publishRepair(actions, run.id, {
      summary: "duplicate",
      edits: [{ path: "src/app.ts", contents: "fixed" }],
    });
    assert.equal(duplicate.healing?.pullNumber, repaired.healing?.pullNumber);
    const recursive = await actions.manual(alice, "acme", "widget", {
      workflow: ".forgit/workflows/ci.yml",
      ref: repaired.healing!.branch!,
    });
    await actions.jobFinished(recursive.id, "test", "failure");
    await actions.finish(recursive.id);
    await assert.rejects(() => healingGrant(actions, recursive.id), /not eligible/);
  });
  it("rechecks permission and branch freshness before publishing a repair", async () => {
    const { actions, alice, git } = await fixture();
    await actions.configure(alice, "acme", "widget", { healing: "repair" });
    const run = await actions.manual(alice, "acme", "widget", {
      workflow: ".forgit/workflows/ci.yml",
      ref: "develop",
    });
    await actions.jobFinished(run.id, "test", "failure");
    await actions.finish(run.id);
    await healingGrant(actions, run.id);
    git.commitFiles({
      owner: "acme",
      repo: "widget",
      branch: "develop",
      message: "advance",
      files: { "src/app.ts": "different" },
    });
    await assert.rejects(
      () =>
        publishRepair(actions, run.id, {
          summary: "Fix",
          edits: [{ path: "src/app.ts", contents: "fixed" }],
        }),
      /advanced/,
    );
    assert.equal(await git.resolve("acme", "widget", `actions/fix/${run.id}`), null);
    await actions.cancel(alice, "acme", "widget", run.id);
    assert.equal((await actions.store.get(run.id))?.conclusion, "failure");
    assert.equal((await actions.store.get(run.id))?.healing?.status, "failed");
  });
});

it("requires the exact method and route for Actions mutations", () => {
  for (const op of ["configure", "secret", "environment", "retry-events"])
    assert.throws(() => actionHttpOperation("GET", [op]), /not allowed/);
  assert.equal(actionHttpOperation("POST", ["retry-events"]), "retry-events");
  assert.equal(actionHttpOperation("POST", ["runs", "id", "cancel"]), "cancel");
  assert.throws(() => actionHttpOperation("GET", ["runs", "id", "cancel"]));
  assert.throws(() => actionHttpOperation("POST", ["runs", "id"]));
});

it("keeps infrastructure errors red even when commands completed", async () => {
  const { actions, alice } = await fixture();
  const run = await actions.manual(alice, "acme", "widget", {
    workflow: ".forgit/workflows/ci.yml",
    ref: "main",
  });
  await actions.jobFinished(run.id, "test", "success");
  assert.equal(
    (await actions.finish(run.id, "Snapshot finalization failed")).conclusion,
    "failure",
  );
});

it("exposes Actions through MCP with the same repository and workflow permissions", async () => {
  const { handleMcp } = await import("../packages/mcp/src/index.ts");
  const { actions, alice, bob, cara, forge } = await fixture();
  const changed: string[] = [];
  const extension = {
    service: actions,
    readLog: async () => "output",
    changed: async (op: string) => {
      changed.push(op);
    },
  };
  const call = (actor: typeof alice, name: string, args: Record<string, unknown>) =>
    handleMcp(
      new Request("https://git.example.com/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: { owner: "acme", repo: "widget", ...args } },
        }),
      }),
      forge,
      actor,
      extension,
    ).then((r) => r.json()) as Promise<{
      result: { isError: boolean; structuredContent: { run: { id: string } } };
    }>;
  const dispatched = await call(alice, "run_workflow", {
    workflow: ".forgit/workflows/ci.yml",
    ref: "main",
  });
  assert.equal(dispatched.result.isError, false);
  assert.deepEqual(changed, ["run"]);
  const runId = dispatched.result.structuredContent.run.id;
  assert.equal((await call(cara, "get_action_run", { runId })).result.isError, true);
  assert.equal(
    (await call({ ...bob, tokenScopes: ["repo:read"] }, "cancel_action_run", { runId })).result
      .isError,
    true,
  );
  assert.equal(
    (
      await call({ ...bob, tokenScopes: ["repo:read", "workflow:run"] }, "cancel_action_run", {
        runId,
      })
    ).result.isError,
    false,
  );
});

it("accepts explicitly granted deployment provider variables", () => {
  const workflow = parseWorkflow(
    YAML.replace(
      "runs-on: node-26",
      "runs-on: node-26\n    environment: production\n    env:\n      CLOUDFLARE_API_TOKEN: ${{ secrets.DEPLOY_TOKEN }}\n      AWS_REGION: us-east-1",
    ),
  );
  assert.equal(workflow.jobs[0]?.env.CLOUDFLARE_API_TOKEN, "${{ secrets.DEPLOY_TOKEN }}");
  assert.throws(
    () =>
      parseWorkflow(
        YAML.replace(
          "runs-on: node-26",
          "runs-on: node-26\n    env:\n      SOURCE_CONTROL_TOKEN: spoof",
        ),
      ),
    /reserved/,
  );
});
