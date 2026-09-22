import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryStore, recordAuthEvent } from "@forgit/domain";

describe("auth audit", () => {
  it("records sign-up and sign-in without a repository", async () => {
    const store = new MemoryStore();
    await recordAuthEvent(store, { action: "auth.sign_up", userId: "alice" });
    await recordAuthEvent(store, { action: "auth.sign_in", userId: "alice" });
    assert.deepEqual(
      store.audit.map((event) => event.action),
      ["auth.sign_up", "auth.sign_in"],
    );
    assert.equal(store.audit[0]?.repositoryId, null);
    assert.equal(store.audit[0]?.actorId, "alice");
  });
});
