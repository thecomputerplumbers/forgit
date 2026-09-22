import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpGitClient } from "@forgit/git-client";

describe("walgit http client", () => {
  it("calls admin routes as the service token and reads as the end user", async () => {
    const calls: Array<{ url: string; method: string; principal: string | null }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        method: init?.method ?? "GET",
        principal: headers.get("x-walgit-principal"),
      });
      return new Response("{}", { status: 200 });
    };
    const git = new HttpGitClient({
      baseUrl: "http://git.internal",
      serviceToken: "service",
      mergeToken: "merge",
      principal: "ada",
      fetch: fetchImpl,
    });
    await git.createRepository("acme", "widget");
    await git.setProtectedBranch("acme", "widget", "main");
    await git.deleteRepository("acme", "widget");
    await git.summary("acme", "widget");
    assert.deepEqual(
      calls.map((call) => [call.method, new URL(call.url).pathname, call.principal]),
      [
        ["PUT", "/acme/widget", null],
        ["PUT", "/acme/widget/api/policy", null],
        ["DELETE", "/acme/widget", null],
        ["GET", "/acme/widget/api", "ada"],
      ],
    );
  });
});
