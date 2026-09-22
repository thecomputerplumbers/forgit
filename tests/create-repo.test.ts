import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createServices, ForgeError, MemoryStore } from "@forgit/domain";
import { MemoryGit } from "@forgit/git-client";

describe("repository creation", () => {
  it("drops the metadata row when the git store rejects the create", async () => {
    const store = new MemoryStore();
    store.seedUser(
      { id: "alice", name: "Alice", email: "alice@example.com", login: "alice" },
      { id: "org", name: "Acme", slug: "acme", role: "owner" },
    );
    const git = new MemoryGit("https://git.example.com");
    git.createRepository = async () => {
      throw new Error("Git storage is not configured");
    };
    const services = createServices(store, git, "https://git.example.com");
    const alice = await services.actorFromUser("alice");
    await assert.rejects(
      () => services.createRepository(alice, { owner: "acme", name: "widget" }),
      (error: unknown) =>
        error instanceof ForgeError &&
        error.status === 503 &&
        error.message === "Git storage is not configured",
    );
    assert.equal(await store.getRepositoryByName("org", "widget"), null);
    assert.equal(await git.summary("acme", "widget"), null);
  });

  it("removes the git repository when branch protection fails", async () => {
    const store = new MemoryStore();
    store.seedUser(
      { id: "alice", name: "Alice", email: "alice@example.com", login: "alice" },
      { id: "org", name: "Acme", slug: "acme", role: "owner" },
    );
    const git = new MemoryGit("https://git.example.com");
    git.setProtectedBranch = async () => {
      throw new Error("policy rejected");
    };
    const services = createServices(store, git, "https://git.example.com");
    const alice = await services.actorFromUser("alice");
    await assert.rejects(
      () => services.createRepository(alice, { owner: "acme", name: "widget" }),
      (error: unknown) =>
        error instanceof ForgeError && error.status === 503 && error.message === "policy rejected",
    );
    assert.equal(await store.getRepositoryByName("org", "widget"), null);
    assert.equal(await git.summary("acme", "widget"), null);
  });

  it("stamps audit events with the request id", async () => {
    const store = new MemoryStore();
    store.seedUser(
      { id: "alice", name: "Alice", email: "alice@example.com", login: "alice" },
      { id: "org", name: "Acme", slug: "acme", role: "owner" },
    );
    const services = createServices(
      store,
      new MemoryGit("https://git.example.com"),
      "https://git.example.com",
      "req-123",
    );
    const alice = await services.actorFromUser("alice");
    await services.createRepository(alice, { owner: "acme", name: "widget" });
    assert.equal(store.audit.at(-1)?.requestId, "req-123");
    assert.equal(store.audit.at(-1)?.action, "repo.create");
  });

  it("deletes the git repository and its metadata together", async () => {
    const store = new MemoryStore();
    store.seedUser(
      { id: "alice", name: "Alice", email: "alice@example.com", login: "alice" },
      { id: "org", name: "Acme", slug: "acme", role: "owner" },
    );
    const git = new MemoryGit("https://git.example.com");
    const services = createServices(store, git, "https://git.example.com", "req-delete");
    const alice = await services.actorFromUser("alice");
    await services.createRepository(alice, { owner: "acme", name: "widget" });
    await services.destroyRepository(alice, "acme", "widget");
    assert.equal(await store.getRepositoryByName("org", "widget"), null);
    assert.equal(await git.summary("acme", "widget"), null);
    assert.equal(store.audit.at(-1)?.action, "repo.delete");
    assert.equal(store.audit.at(-1)?.requestId, "req-delete");
  });
});
