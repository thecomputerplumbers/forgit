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
  });
});
