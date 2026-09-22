import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ForgeError } from "@forgit/domain";

import { world } from "./fixture.ts";

describe("pull requests", () => {
  it("opens, reviews, checks, and squash-merges without moving a raced base", async () => {
    const { services, git, store, alice, bob, repo } = await world();
    git.commitFiles({
      owner: "acme",
      repo: "widget",
      branch: "feature",
      message: "add note",
      files: { "README.md": "hello\n", "NOTE.md": "ship it\n" },
    });
    const pr = await services.openPullRequest(bob, "acme", "widget", {
      title: "Add a note",
      sourceRef: "feature",
      targetRef: "main",
    });
    assert.equal(pr.number, 1);
    await assert.rejects(
      () => services.reviewPullRequest(bob, "acme", "widget", 1, { state: "approved" }),
      (error: unknown) => error instanceof ForgeError && error.code === "self_approval",
    );
    await services.reviewPullRequest(alice, "acme", "widget", 1, {
      state: "approved",
      body: "yes",
    });
    await store.setRules({
      repositoryId: repo.id,
      requiredApprovals: 1,
      requiredChecks: ["ci"],
      dismissStaleReviews: true,
    });
    await assert.rejects(
      () => services.mergePullRequest(alice, "acme", "widget", 1),
      (error: unknown) => error instanceof ForgeError && error.code === "checks",
    );
    const head = (await services.store.getPullRequest(repo.id, 1))?.headSha ?? "";
    await services.recordCheck(alice, "acme", "widget", {
      name: "ci",
      headSha: head,
      status: "completed",
      conclusion: "success",
    });
    const merged = await services.mergePullRequest(alice, "acme", "widget", 1, {
      expectedHeadSha: head,
      idempotencyKey: "merge-1",
    });
    assert.equal(merged.pr.state, "merged");
    assert.equal(git.repos.get("acme/widget")?.refs.get("main"), merged.sha);
    const again = await services.mergePullRequest(alice, "acme", "widget", 1, {
      idempotencyKey: "merge-1",
    });
    assert.equal(again.sha, merged.sha);
    const audit = await store.listAudit(repo.id, 20);
    assert.ok(audit.some((event) => event.action === "pull_request.merge"));
  });

  it("dismisses a stale approval after the head moves and refuses a direct push to main", async () => {
    const { services, git, store, alice, bob, repo } = await world();
    const first = git.commitFiles({
      owner: "acme",
      repo: "widget",
      branch: "feature",
      message: "one",
      files: { "README.md": "one\n" },
    });
    await services.openPullRequest(bob, "acme", "widget", {
      title: "Work",
      sourceRef: "feature",
      targetRef: "main",
    });
    await services.reviewPullRequest(alice, "acme", "widget", 1, { state: "approved" });
    const second = git.commitFiles({
      owner: "acme",
      repo: "widget",
      branch: "feature",
      message: "two",
      files: { "README.md": "two\n" },
    });
    assert.notEqual(first, second);
    await services.syncPullRequest("acme", "widget", 1);
    await assert.rejects(
      () => services.mergePullRequest(alice, "acme", "widget", 1),
      (error: unknown) => error instanceof ForgeError && error.code === "reviews",
    );
    assert.throws(
      () =>
        git.commitFiles({
          owner: "acme",
          repo: "widget",
          branch: "main",
          message: "force",
          files: { "README.md": "nope\n" },
        }),
      /rejected by rule/,
    );
    const comments = await services.commentOnPullRequest(alice, "acme", "widget", 1, {
      path: "README.md",
      body: "see latest",
      line: 1,
    });
    assert.equal(comments.commitSha, second);
    assert.equal((await store.getPullRequest(repo.id, 1))?.headSha, second);
  });

  it("refuses a merge when both sides edit the same file", async () => {
    const { services, git, alice, bob } = await world();
    git.commitFiles({
      owner: "acme",
      repo: "widget",
      branch: "feature",
      message: "feature",
      files: { "README.md": "feature\n" },
    });
    await services.openPullRequest(bob, "acme", "widget", {
      title: "Conflict",
      sourceRef: "feature",
      targetRef: "main",
    });
    const moved = git.commitFiles({
      owner: "acme",
      repo: "widget",
      branch: "main",
      message: "main moves",
      files: { "README.md": "main\n" },
      principal: "svc:forgit-merge",
    });
    await services.reviewPullRequest(alice, "acme", "widget", 1, { state: "approved" });
    await assert.rejects(
      () => services.mergePullRequest(alice, "acme", "widget", 1),
      (error: unknown) => error instanceof ForgeError && error.code === "conflict",
    );
    assert.equal(git.repos.get("acme/widget")?.refs.get("main"), moved);
  });

  it("fails the compare-and-swap when the recorded head no longer matches", async () => {
    const { services, git, alice, bob } = await world();
    git.commitFiles({
      owner: "acme",
      repo: "widget",
      branch: "feature",
      message: "one",
      files: { "README.md": "one\n" },
    });
    const pr = await services.openPullRequest(bob, "acme", "widget", {
      title: "Work",
      sourceRef: "feature",
      targetRef: "main",
    });
    await services.reviewPullRequest(alice, "acme", "widget", 1, { state: "approved" });
    await storeRulesOff(services, pr.repositoryId);
    await assert.rejects(
      () =>
        services.mergePullRequest(alice, "acme", "widget", 1, { expectedHeadSha: "a".repeat(40) }),
      (error: unknown) => error instanceof ForgeError && error.code === "stale_head",
    );
  });
});

async function storeRulesOff(
  services: Awaited<ReturnType<typeof world>>["services"],
  repositoryId: string,
) {
  await services.store.setRules({
    repositoryId,
    requiredApprovals: 1,
    requiredChecks: [],
    dismissStaleReviews: true,
  });
}
