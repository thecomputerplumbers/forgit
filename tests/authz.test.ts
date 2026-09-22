import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ForgeError } from "@forgit/domain";
import { classifyPath, lfsBatchWrites } from "@forgit/git-client";

import { world } from "./fixture.ts";

describe("authorization", () => {
  it("rejects a token after revocation and a token scoped to another repository", async () => {
    const { services, alice, cara, repo } = await world();
    const minted = await services.createToken(alice, {
      name: "laptop",
      scopes: ["repo:read", "repo:write", "pull_request:read", "pull_request:write"],
      repositoryIds: [repo.id],
    });
    const actor = await services.actorFromAuthorization(`Bearer ${minted.plaintext}`);
    assert.equal(actor?.userId, "alice");
    assert.equal(actor?.repositoryIds?.[0], repo.id);
    await services.revokeToken(alice, minted.token.id);
    assert.equal(await services.actorFromAuthorization(`token ${minted.plaintext}`), null);
    const other = await services.createRepository(alice, { owner: "acme", name: "other" });
    const narrowed = await services.createToken(alice, {
      name: "one-repo",
      scopes: ["repo:read"],
      repositoryIds: [other.repo.id],
    });
    const narrowedActor = await services.actorFromAuthorization(
      `Basic ${btoa(`git:${narrowed.plaintext}`)}`,
    );
    await assert.rejects(
      () => services.requireRepo(narrowedActor, "acme", "widget", "read"),
      (error: unknown) => error instanceof ForgeError && error.code === "forbidden",
    );
    await assert.rejects(
      () => services.requireRepo(cara, "acme", "widget", "read"),
      (error: unknown) => error instanceof ForgeError && error.code === "forbidden",
    );
  });

  it("lets a public repository be read anonymously and still requires write to push", async () => {
    const { services, alice, repo } = await world();
    await services.store.updateRepository(
      (await services.store.getRepositoryByName("org", "widget"))?.id ?? "",
      { visibility: "public" },
    );
    const found = await services.requireRepo(null, "acme", "widget", "read");
    assert.equal(found.actual, "read");
    await assert.rejects(() => services.requireRepo(null, "acme", "widget", "write"));
    await assert.rejects(() => services.requireRepo(alice, "acme", "missing", "read"));
    const named = await services.createToken(alice, {
      name: "named",
      scopes: ["repo:read"],
      repositories: ["acme/widget"],
    });
    const namedActor = await services.actorFromAuthorization(`Bearer ${named.plaintext}`);
    assert.deepEqual(namedActor?.repositoryIds, [repo.id]);
    await assert.rejects(
      () =>
        services.createToken(alice, {
          name: "ci",
          scopes: ["repo:read"],
          kind: "machine",
        }),
      (error: unknown) => error instanceof ForgeError && error.code === "expiry",
    );
  });
});

describe("git path classification", () => {
  it("keeps application routes and traversal out of the git proxy", () => {
    assert.equal(classifyPath("/acme/widget.git/info/refs", "GET").kind, "git");
    assert.equal(classifyPath("/acme/widget.git/git-receive-pack", "POST").kind, "git");
    const write = classifyPath("/acme/widget.git/git-receive-pack", "POST");
    assert.equal(write.kind === "git" && write.write, true);
    assert.equal(classifyPath("/acme/widget.git/git-upload-pack", "POST").kind, "git");
    assert.equal(classifyPath("/api/v3/user", "GET").kind, "app");
    assert.equal(classifyPath("/mcp", "POST").kind, "app");
    assert.equal(classifyPath("/acme/widget", "GET").kind, "app");
    assert.equal(classifyPath("/api/widget.git/info/refs", "GET").kind, "app");
    assert.equal(classifyPath("/acme/..%2Fsecret.git/info/refs", "GET").kind, "app");
    assert.equal(classifyPath("/healthz", "GET").kind, "health");
    const upload = classifyPath("/acme/widget.git/info/lfs/objects/abc", "PUT");
    assert.equal(upload.kind === "git" && upload.write, true);
    const verify = classifyPath("/acme/widget.git/info/lfs/verify", "POST");
    assert.equal(verify.kind === "git" && verify.write, true);
    const download = classifyPath("/acme/widget.git/info/lfs/objects/abc", "GET");
    assert.equal(download.kind === "git" && download.write, false);
    const batch = classifyPath("/acme/widget.git/info/lfs/objects/batch", "POST");
    assert.equal(batch.kind === "git" && batch.write, false);
    assert.equal(classifyPath("/acme/widget.git", "PUT").kind, "app");
    assert.equal(classifyPath("/acme/widget.git", "DELETE").kind, "app");
    assert.equal(classifyPath("/acme/widget.git/git-receive-pack", "GET").kind, "app");
    const bundles = classifyPath("/acme/widget.git/bundles/list", "GET");
    assert.equal(bundles.kind === "git" && bundles.write, false);
    assert.equal(classifyPath("/acme/widget.git/bundles/hourly/pack.bundle", "PUT").kind, "app");
    assert.equal(lfsBatchWrites('{"operation":"upload","objects":[]}'), true);
    assert.equal(lfsBatchWrites('{"operation":"download","objects":[]}'), false);
    assert.equal(lfsBatchWrites("not-json"), true);
  });
});
