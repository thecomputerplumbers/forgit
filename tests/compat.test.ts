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
    const diff = await handleGithubRest(
      new Request(`https://git.example.com/api/v3/repos/acme/widget/pulls/${pr.number}`, {
        headers: { accept: "application/vnd.github.v3.diff" },
      }),
      ctx,
    );
    assert.equal(diff?.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.match(await diff!.text(), /NOTE\.md/);
    const listed = await handleGithubGraphql(
      new Request("https://git.example.com/api/graphql", {
        method: "POST",
        body: JSON.stringify({
          query: `query PullRequestList($owner: String!, $repo: String!) {
            repository(owner: $owner, name: $repo) {
              pullRequests(states: $state, first: 30) { totalCount nodes { number title } }
            }
          }`,
          variables: { owner: "acme", repo: "widget", state: ["OPEN"] },
        }),
      }),
      ctx,
    );
    const listedBody = (await listed?.json()) as {
      data: {
        repository: { pullRequests: { totalCount: number; nodes: Array<{ number: number }> } };
      };
    };
    assert.equal(listedBody.data.repository.pullRequests.totalCount, 1);
    assert.equal(listedBody.data.repository.pullRequests.nodes[0]?.number, pr.number);
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

  it("answers the calls gh auth status makes", async () => {
    const { services, alice } = await world();
    const ctx = { services, actor: alice, origin: services.origin };
    const root = await handleGithubRest(new Request("https://git.example.com/api/v3/"), ctx);
    assert.equal(root?.status, 200);
    assert.match(root?.headers.get("X-OAuth-Scopes") ?? "", /repo/);
    const viewer = await handleGithubGraphql(
      new Request("https://git.example.com/api/graphql", {
        method: "POST",
        body: JSON.stringify({ query: "query UserCurrent { viewer { login } }" }),
      }),
      ctx,
    );
    const body = (await viewer?.json()) as { data: { viewer: { login: string } } };
    assert.equal(body.data.viewer.login, "alice");
    const bare = await handleGithubRest(new Request("https://git.example.com/api/v3"), ctx);
    assert.equal(bare?.status, 200);
    const owner = await handleGithubRest(
      new Request("https://git.example.com/api/v3/users/acme"),
      ctx,
    );
    const ownerBody = (await owner?.json()) as { type: string; node_id: string };
    assert.equal(ownerBody.type, "Organization");
    assert.equal(ownerBody.node_id, "forgit:org:acme");
    const created = await handleGithubGraphql(
      new Request("https://git.example.com/api/graphql", {
        method: "POST",
        body: JSON.stringify({
          query:
            "mutation RepositoryCreate($input: CreateRepositoryInput!) { createRepository(input: $input) { repository { name owner { login } } } }",
          variables: {
            input: { name: "other", ownerId: "forgit:org:acme", visibility: "PRIVATE" },
          },
        }),
      }),
      ctx,
    );
    const createdBody = (await created?.json()) as {
      data: { createRepository: { repository: { name: string; owner: { login: string } } } };
    };
    assert.equal(createdBody.data.createRepository.repository.name, "other");
    assert.equal(createdBody.data.createRepository.repository.owner.login, "acme");
    const info = await handleGithubGraphql(
      new Request("https://git.example.com/api/graphql", {
        method: "POST",
        body: JSON.stringify({
          query: `query RepositoryInfo($owner: String!, $name: String!) {
            repository(owner: $owner, name: $name) {
              id
              name
              viewerPermission
              defaultBranchRef { name }
              squashMergeAllowed
            }
          }`,
          variables: { owner: "acme", name: "other" },
        }),
      }),
      ctx,
    );
    const infoBody = (await info?.json()) as {
      data: {
        repository: { id: string; viewerPermission: string; squashMergeAllowed: boolean };
      };
    };
    assert.equal(infoBody.data.repository.viewerPermission, "ADMIN");
    assert.equal((infoBody.data.repository as { visibility?: string }).visibility, "PRIVATE");
    assert.equal(infoBody.data.repository.squashMergeAllowed, true);
    assert.equal(infoBody.data.repository.id, repoNodeId("acme", "other"));
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

    const projectItems = await handleGithubGraphql(
      new Request("https://git.example.com/api/graphql", {
        method: "POST",
        body: JSON.stringify({
          query:
            "query PullRequestProjectItems($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { projectItems(first: 100) { totalCount nodes { id } pageInfo { hasNextPage endCursor } } } } }",
          variables: { owner: "acme", name: "widget", number: 1 },
        }),
      }),
      { services, actor: bob, origin: services.origin },
    );
    assert.deepEqual(await projectItems?.json(), {
      data: {
        repository: {
          pullRequest: {
            projectItems: {
              totalCount: 0,
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    });
  });

  it("answers gh schema feature probes", async () => {
    const { services, alice } = await world();
    const response = await handleGithubGraphql(
      new Request("https://git.example.com/api/graphql", {
        method: "POST",
        body: JSON.stringify({
          query:
            'query Issue_fields { Issue: __type(name: "Issue") { fields(includeDeprecated: true) { name } } }',
        }),
      }),
      { services, actor: alice, origin: services.origin },
    );
    assert.equal(response?.status, 200);
    assert.deepEqual(await response?.json(), { data: { Issue: { fields: [] } } });
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
    const ctx = { services, actor: alice, origin: services.origin };
    const restPr = await handleGithubRest(
      new Request(`https://git.example.com/api/v3/repos/acme/widget/pulls/${opened.number}`),
      ctx,
    );
    const restBody = (await restPr?.json()) as {
      title: string;
      head: { sha: string; ref: string };
    };
    assert.equal(restBody.title, read.title);
    assert.equal(restBody.head.sha, read.headSha);
    assert.equal(restBody.head.ref, "agent");
    const restFile = await handleGithubRest(
      new Request("https://git.example.com/api/v3/repos/acme/widget/contents/AGENT.md?ref=agent"),
      ctx,
    );
    const restContents = (await restFile?.json()) as { content: string };
    assert.equal(restContents.content, file.content);
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
