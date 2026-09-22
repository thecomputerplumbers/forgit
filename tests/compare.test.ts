import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryGit } from "@forgit/git-client";

describe("compare", () => {
  it("marks a pull request that edits the same lines on both sides as conflicting", async () => {
    const git = new MemoryGit("https://git.example.com");
    await git.createRepository("acme", "widget");
    git.commitFiles({
      owner: "acme",
      repo: "widget",
      branch: "main",
      message: "start",
      files: { "README.md": "a\n" },
    });
    await git.createBranch({ owner: "acme", repo: "widget", branch: "feature", fromRef: "main" });
    git.commitFiles({
      owner: "acme",
      repo: "widget",
      branch: "feature",
      message: "feature",
      files: { "README.md": "feature\n" },
    });
    const clean = await git.compare("acme", "widget", "main", "feature");
    assert.equal(clean?.mergeable, true);
    git.commitFiles({
      owner: "acme",
      repo: "widget",
      branch: "main",
      message: "main moves",
      files: { "README.md": "main\n" },
    });
    const conflict = await git.compare("acme", "widget", "main", "feature");
    assert.equal(conflict?.mergeable, false);
  });
});
