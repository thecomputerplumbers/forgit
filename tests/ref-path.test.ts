import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { splitRefPath } from "../apps/web/lib/ref-path.ts";

describe("ref paths", () => {
  const names = ["main", "feature/login"];

  it("keeps a slash branch together and leaves the file path", () => {
    assert.deepEqual(splitRefPath(["feature", "login", "README.md"], names, "main"), {
      ref: "feature/login",
      path: "README.md",
    });
  });

  it("prefers the longer ref when both prefixes exist", () => {
    assert.deepEqual(splitRefPath(["feature", "login"], names, "main"), {
      ref: "feature/login",
      path: "",
    });
  });

  it("uses the default branch when the slug is empty", () => {
    assert.deepEqual(splitRefPath([], names, "main"), { ref: "main", path: "" });
  });
});
