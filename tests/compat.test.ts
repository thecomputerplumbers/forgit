import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handleGithubGraphql, handleGithubRest, repoNodeId } from "@forgit/github-compat";
import { handleMcp, MCP_TOOLS } from "@forgit/mcp";

import { world } from "./fixture.ts";

describe("github rest and graphql", () => {
  it("serves the gh-shaped user, repository, and pull request routes", async () => {
    const { services, git, alice, bob } = await world();
    git.commitFiles({
      owner: "acme",
      repo: "widget",
      branch: "feature",
      message: "add",
      files: { "NOTE.md": "hi\n" },
    });
    const ctx = { services, actor: alice, origin: services.origin };
    const user = await handleGithubRest(new Request("https://git.example.com/api/v3/user"), ctx);
    assert.ok(user);
    assert.equal(((await user.json()) as { login: string }).login, "alice");
    const view = await handleGithubRest(
      new Request("https://git.example.com/api/v3/repos/acme/widget"),
      ctx,
    );
    const repo = (await view?.json()) as { full_name: string; clone_url: string; node_id: string };
    assert.equal(repo.full_name, "acme/widget");
    assert.equal(repo.clone_url, "https://git.example.com/acme/widget.git");
    assert.equal(repo.node_id, repoNodeId("acme", "widget"));
    const created = await handleGithubRest(
      new Request("https://git.example.com/api/v3/repos/acme/widget/pulls", {
        method: "POST",
        body: JSON.stringify({ title: "Add note", head: "feature", base: "main" }),
      }),
      { ...ctx, actor: bob },
    );
    assert.equal(created?.status, 201);
    const pr = (await created?.json()) as { number: number };
    await services.reviewPullRequest(alice, "acme", "widget", pr.number, { state: "approved" });
    const review = await handleGithubRest(
      new Request(`https://git.example.com/api/v3/repos/acme/widget/pulls/${pr.number}/reviews`, {
        method: "POST",
        body: JSON.stringify({ event: "COMMENT", body: "looks fine" }),
      }),
      ctx,
    );
    assert.equal(review?.status, 200);
    const merged = await handleGithubRest(
      new Request(`https://git.example.com/api/v3/repos/acme/widget/pulls/${pr.number}/merge`, {
        method: "PUT",
        body: JSON.stringify({ merge_method: "squash" }),
      }),
      ctx,
    );
    const mergeBody = (await merged?.json()) as { merged: boolean; sha: string };
    assert.equal(mergeBody.merged, true);
    assert.equal(mergeBody.sha.length, 40);
    const rebase = await handleGithubRest(
      new Request("https://git.example.com/api/v3/repos/acme/widget/pulls/1/merge", {
        method: "PUT",
        body: JSON.stringify({ merge_method: "rebase" }),
      }),
      ctx,
    );
    assert.equal(rebase?.status, 422);
  });

  it("creates a pull request through the GraphQL mutation gh uses", async () => {
    const { services, git, bob } = await world();
    git.commitFiles({
      owner: "acme",
      repo: "widget",
      branch: "feature",
      message: "add",
      files: { "NOTE.md": "hi\n" },
    });
    const response = await handleGithubGraphql(
      new Request("https://git.example.com/api/graphql", {
        method: "POST",
        body: JSON.stringify({
          query:
            "mutation CreatePullRequest($input: CreatePullRequestInput!) { createPullRequest(input: $input) { pullRequest { number url } } }",
          variables: {
            input: {
              repositoryId: repoNodeId("acme", "widget"),
              title: "From gh",
              headRefName: "feature",
              baseRefName: "main",
            },
          },
        }),
      }),
      { services, actor: bob, origin: services.origin },
    );
    const body = (await response?.json()) as {
      data: { createPullRequest: { pullRequest: { number: number } } };
    };
    assert.equal(body.data.createPullRequest.pullRequest.number, 1);
  });
});

describe("mcp", () => {
  it("advertises the tool schemas and refuses an unauthenticated call", async () => {
    const { services } = await world();
    const listed = await handleMcp(
      new Request("https://git.example.com/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      services,
      null,
    );
    const tools = (await listed.json()) as { result: { tools: Array<{ name: string }> } };
    assert.deepEqual(
      tools.result.tools.map((tool) => tool.name),
      MCP_TOOLS.map((tool) => tool.name),
    );
    const denied = await handleMcp(
      new Request("https://git.example.com/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "get_me", arguments: {} },
        }),
      }),
      services,
      null,
    );
    const error = (await denied.json()) as { result: { isError: boolean } };
    assert.equal(error.result.isError, true);
  });

  it("lets an agent branch, commit, open a pull request, and read it back", async () => {
    const { services, alice, bob } = await world();
    await call(services, bob, "create_branch", {
      owner: "acme",
      repo: "widget",
      branch: "agent",
      from: "main",
    });
    await call(services, bob, "create_or_update_file", {
      owner: "acme",
      repo: "widget",
      branch: "agent",
      path: "AGENT.md",
      content: "from an agent\n",
      message: "agent edit",
    });
    const opened = (await call(services, bob, "create_pull_request", {
      owner: "acme",
      repo: "widget",
      title: "Agent change",
      head: "agent",
      base: "main",
    })) as { number: number };
    const read = (await call(services, alice, "pull_request_read", {
      owner: "acme",
      repo: "widget",
      pullNumber: opened.number,
    })) as { title: string; headSha: string };
    assert.equal(read.title, "Agent change");
    assert.equal(read.headSha.length, 40);
    const file = (await call(services, alice, "get_file_contents", {
      owner: "acme",
      repo: "widget",
      path: "AGENT.md",
      ref: "agent",
    })) as { content: string };
    assert.match(file.content, /agent/);
  });
});

async function call(
  services: Awaited<ReturnType<typeof world>>["services"],
  actor: Awaited<ReturnType<typeof world>>["alice"],
  name: string,
  arguments_: Record<string, unknown>,
) {
  const response = await handleMcp(
    new Request("https://git.example.com/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: arguments_ },
      }),
    }),
    services,
    actor,
  );
  const body = (await response.json()) as {
    result: { isError?: boolean; structuredContent?: unknown; content?: Array<{ text: string }> };
  };
  assert.equal(body.result.isError, false, body.result.content?.[0]?.text);
  return body.result.structuredContent;
}
