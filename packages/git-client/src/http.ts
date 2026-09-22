import { GitError, type GitClient, type GitCommit, type SquashMergeInput } from "./types.ts";

export type HttpGitOptions = {
  baseUrl: string;
  serviceToken: string;
  mergeToken: string;
  principal: string;
  fetch?: typeof fetch;
};

type Json = Record<string, unknown>;

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  return text.slice(0, 500) || response.statusText;
}

export class HttpGitClient implements GitClient {
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: HttpGitOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetch = options.fetch ?? fetch;
  }

  private headers(json = false, asService = false): Headers {
    const headers = new Headers({
      authorization: `Bearer ${this.options.serviceToken}`,
    });
    // Create, delete, and policy are admin operations. Forwarding the end user
    // drops admin: walgit grants it to the forwarded name only when that name
    // is itself an admin token.
    if (!asService) headers.set("x-walgit-principal", this.options.principal);
    if (json) headers.set("content-type", "application/json");
    return headers;
  }

  private async send(
    path: string,
    init: RequestInit = {},
    json = false,
    asService = false,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    for (const [key, value] of this.headers(json, asService)) headers.set(key, value);
    return this.fetch(`${this.baseUrl}${path}`, { ...init, headers });
  }

  private async getJson<T>(path: string): Promise<T | null> {
    const response = await this.send(path, { method: "GET" });
    if (response.status === 404) return null;
    if (!response.ok) throw new GitError(await readError(response), response.status);
    return (await response.json()) as T;
  }

  async createRepository(owner: string, name: string): Promise<void> {
    const response = await this.send(`/${owner}/${name}`, { method: "PUT" }, false, true);
    if (response.status === 200 || response.status === 201) return;
    throw new GitError(await readError(response), response.status);
  }

  async deleteRepository(owner: string, name: string): Promise<void> {
    const response = await this.send(`/${owner}/${name}`, { method: "DELETE" }, false, true);
    if (response.status === 200 || response.status === 204 || response.status === 404) return;
    throw new GitError(await readError(response), response.status);
  }

  async setProtectedBranch(owner: string, name: string, branch: string): Promise<void> {
    const policy = {
      version: 1,
      groups: [{ name: "merge", members: ["svc:forgit-merge"] }],
      rules: [
        {
          name: `lock-${branch}`.replace(/[^a-z0-9-]/g, "").slice(0, 63) || "lock-default",
          match: { refs: [`refs/heads/${branch}`] },
          effect: {
            protect: {
              restricts: ["update", "delete"],
              bypass: ["group:merge"],
            },
          },
        },
      ],
    };
    const response = await this.send(
      `/${owner}/${name}/api/policy`,
      {
        method: "PUT",
        body: JSON.stringify(policy),
      },
      true,
      true,
    );
    if (!response.ok) throw new GitError(await readError(response), response.status);
  }

  async summary(owner: string, name: string) {
    const body = await this.getJson<Json>(`/${owner}/${name}/api`);
    if (!body) return null;
    const head = body.head as { name?: string; sha?: string } | null;
    return {
      owner,
      name,
      head: head?.sha && head.name ? { name: head.name, sha: head.sha } : null,
      branches: Number(body.branches ?? 0),
      tags: Number(body.tags ?? 0),
      cloneUrl: String(body.clone_url ?? `${this.baseUrl}/${owner}/${name}.git`),
    };
  }

  async tree(owner: string, name: string, ref: string, path: string) {
    const suffix = path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : "";
    const body = await this.getJson<Json>(
      `/${owner}/${name}/api/tree/${encodeURIComponent(ref)}${suffix}`,
    );
    if (!body) return null;
    return {
      ref: String(body.ref ?? ref),
      sha: String(body.sha ?? ""),
      path: String(body.path ?? path),
      entries: ((body.entries as Json[]) ?? []).map((entry) => ({
        name: String(entry.name),
        type: entry.type as "blob" | "tree" | "commit",
        mode: String(entry.mode),
        size: Number(entry.size),
        sha: String(entry.sha),
      })),
      commit: body.commit ? mapCommit(body.commit as Json) : null,
      readme: body.readme
        ? {
            name: String((body.readme as Json).name),
            contents: String((body.readme as Json).contents ?? ""),
          }
        : null,
    };
  }

  async blob(owner: string, name: string, ref: string, path: string) {
    const suffix = path.split("/").map(encodeURIComponent).join("/");
    const body = await this.getJson<Json>(
      `/${owner}/${name}/api/blob/${encodeURIComponent(ref)}/${suffix}`,
    );
    if (!body) return null;
    return {
      ref: String(body.ref ?? ref),
      sha: String(body.sha ?? ""),
      path: String(body.path ?? path),
      name: String(body.name ?? path),
      size: Number(body.size ?? 0),
      contents: typeof body.contents === "string" ? body.contents : null,
      binary: Boolean(body.binary || body.too_large),
    };
  }

  async commits(owner: string, name: string, ref: string, skip: number, limit: number) {
    const body = await this.getJson<Json>(
      `/${owner}/${name}/api/commits?ref=${encodeURIComponent(ref)}&skip=${skip}&n=${limit}`,
    );
    if (!body) return null;
    return {
      sha: String(body.sha ?? ""),
      commits: ((body.commits as Json[]) ?? []).map(mapCommit),
      more: Boolean(body.more),
    };
  }

  async commit(owner: string, name: string, rev: string) {
    const body = await this.getJson<Json>(
      `/${owner}/${name}/api/commit/${encodeURIComponent(rev)}`,
    );
    if (!body) return null;
    return {
      commit: mapCommit(body.commit as Json),
      stats: ((body.stats as Json[]) ?? []).map((stat) => ({
        path: String(stat.path),
        additions: Number(stat.additions),
        deletions: Number(stat.deletions),
      })),
      patch: String(body.patch ?? ""),
    };
  }

  async branches(owner: string, name: string) {
    return this.refs(owner, name, "branches");
  }

  async tags(owner: string, name: string) {
    return this.refs(owner, name, "tags");
  }

  private async refs(owner: string, name: string, kind: "branches" | "tags") {
    const refs: Array<{ name: string; sha: string }> = [];
    let after = "";
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ n: "100" });
      if (after) query.set("after", after);
      const body = await this.getJson<Json>(`/${owner}/${name}/api/refs/${kind}?${query}`);
      if (!body) return [];
      const chunk = ((body.refs as Json[]) ?? []).map((ref) => ({
        name: String(ref.name),
        sha: String(ref.sha),
      }));
      refs.push(...chunk);
      if (!body.more || chunk.length === 0) break;
      after = chunk.at(-1)?.name ?? "";
    }
    return refs;
  }

  async resolve(owner: string, name: string, ref: string) {
    const body = await this.getJson<Json>(
      `/${owner}/${name}/api/resolve/${encodeURIComponent(ref)}`,
    );
    return body ? String(body.sha) : null;
  }

  async compare(owner: string, name: string, base: string, head: string) {
    const response = await this.fetch(`${this.baseUrl}/_forgit/compare`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.mergeToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ owner, repo: name, base, head }),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new GitError(await readError(response), response.status);
    return (await response.json()) as Awaited<ReturnType<GitClient["compare"]>>;
  }

  async squashMerge(input: SquashMergeInput): Promise<{ sha: string }> {
    const response = await this.fetch(`${this.baseUrl}/_forgit/merge`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.mergeToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        owner: input.owner,
        repo: input.repo,
        base_ref: input.baseRef,
        head_ref: input.headRef,
        expected_base: input.expectedBaseSha,
        expected_head: input.expectedHeadSha,
        message: input.message,
        author_name: input.authorName,
        author_email: input.authorEmail,
      }),
    });
    if (!response.ok) throw new GitError(await readError(response), response.status);
    const body = (await response.json()) as { sha?: string };
    if (!body.sha) throw new GitError("Merge helper returned no SHA", 502);
    return { sha: body.sha };
  }

  async createBranch(input: { owner: string; repo: string; branch: string; fromRef: string }) {
    const response = await this.helper("/_forgit/branch", {
      ...input,
      principal: this.options.principal,
    });
    return { sha: String(response.sha ?? "") };
  }

  async writeFile(input: {
    owner: string;
    repo: string;
    branch: string;
    path: string;
    contents: string;
    message: string;
    authorName: string;
    authorEmail: string;
  }) {
    const response = await this.helper("/_forgit/file", {
      owner: input.owner,
      repo: input.repo,
      branch: input.branch,
      path: input.path,
      contents: input.contents,
      message: input.message,
      author_name: input.authorName,
      author_email: input.authorEmail,
      principal: this.options.principal,
    });
    return { commitSha: String(response.commit_sha ?? "") };
  }

  private async helper(path: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.mergeToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new GitError(await readError(response), response.status);
    return (await response.json()) as Record<string, unknown>;
  }
}

function mapCommit(body: Json): GitCommit {
  return {
    sha: String(body.sha ?? ""),
    parents: ((body.parents as string[]) ?? []).map(String),
    author: String(body.author ?? ""),
    authorEmail: String(body.author_email ?? ""),
    authorDate: String(body.author_date ?? ""),
    subject: String(body.subject ?? ""),
    body: String(body.body ?? ""),
  };
}
