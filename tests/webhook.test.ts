import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertWebhookUrl, createServices, ForgeError, MemoryStore } from "@forgit/domain";
import { MemoryGit } from "@forgit/git-client";

import { world } from "./fixture.ts";

describe("webhook urls", () => {
  it("accepts a public https endpoint and rejects local or credentialed targets", () => {
    assert.doesNotThrow(() => assertWebhookUrl("https://hooks.example.com/forgit"));
    for (const url of [
      "http://hooks.example.com/forgit",
      "https://user:pass@hooks.example.com/forgit",
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://10.1.2.3/hook",
      "https://192.168.1.8/hook",
      "https://169.254.169.254/latest",
      "https://metadata.google.internal/hook",
    ]) {
      assert.throws(
        () => assertWebhookUrl(url),
        (error: unknown) => error instanceof ForgeError && error.status === 422,
      );
    }
  });

  it("lets an admin create a webhook and refuses a token without webhook:admin", async () => {
    const store = new MemoryStore();
    store.seedUser(
      { id: "alice", name: "Alice", email: "alice@example.com", login: "alice" },
      { id: "org", name: "Acme", slug: "acme", role: "owner" },
    );
    const services = createServices(
      store,
      new MemoryGit("https://git.example.com"),
      "https://git.example.com",
    );
    const alice = await services.actorFromUser("alice");
    await services.createRepository(alice, { owner: "acme", name: "widget" });
    const hook = await services.createWebhook(alice, "acme", "widget", {
      url: "https://hooks.example.com/forgit",
    });
    assert.match(hook.secret, /^whsec_/);
    assert.equal(store.audit.at(-1)?.action, "webhook.create");
    const minted = await services.createToken(alice, { name: "narrow", scopes: ["repo:admin"] });
    const narrow = await services.actorFromAuthorization(`Bearer ${minted.plaintext}`);
    await assert.rejects(
      () =>
        services.createWebhook(narrow!, "acme", "widget", {
          url: "https://hooks.example.com/other",
        }),
      (error: unknown) => error instanceof ForgeError && error.status === 403,
    );
    await assert.rejects(
      () => services.createWebhook(alice, "acme", "widget", { url: "https://127.0.0.1/hook" }),
      (error: unknown) => error instanceof ForgeError && error.status === 422,
    );
  });

  it("sends a stable delivery id and records the outcome", async () => {
    const { services, git, alice, bob, store } = await world();
    await services.createWebhook(alice, "acme", "widget", {
      url: "https://hooks.example.com/forgit",
    });
    git.commitFiles({
      owner: "acme",
      repo: "widget",
      branch: "feature",
      message: "feature",
      files: { "NOTE.md": "note\n" },
    });
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      seen.push(new Headers(init?.headers).get("x-forgit-delivery") ?? "");
      return new Response(null, { status: 204 });
    };
    try {
      await services.openPullRequest(bob, "acme", "widget", {
        title: "Feature",
        sourceRef: "feature",
        targetRef: "main",
      });
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(seen.length, 1);
    assert.match(seen[0] ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(store.deliveries[0]?.id, seen[0]);
    assert.equal(store.deliveries[0]?.status, "delivered");
    assert.equal(store.deliveries[0]?.event, "pull_request");
  });
});
