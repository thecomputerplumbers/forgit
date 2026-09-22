import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GitError } from "@forgit/git-client";
import { loadGit } from "../apps/web/lib/git-view.ts";

describe("git page loads", () => {
  it("returns the value when git answers", async () => {
    const result = await loadGit(async () => "main");
    assert.deepEqual(result, { value: "main" });
  });

  it("returns the git error instead of throwing", async () => {
    const result = await loadGit(async () => {
      throw new GitError("Git storage is not configured", 503);
    });
    assert.deepEqual(result, { message: "Git storage is not configured" });
  });

  it("rethrows anything that is not a git error", async () => {
    await assert.rejects(() =>
      loadGit(async () => {
        throw new Error("boom");
      }),
    );
  });
});
