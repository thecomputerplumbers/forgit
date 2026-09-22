import {
  GitError,
  type GitClient,
  type GitCommit,
  type GitCompare,
  type GitFileChange,
  type SquashMergeInput,
} from "./types.ts";

type Snapshot = Map<string, string>;

type Commit = {
  sha: string;
  parents: string[];
  author: string;
  authorEmail: string;
  date: string;
  subject: string;
  body: string;
  tree: Snapshot;
};

type Repo = {
  owner: string;
  name: string;
  protectedBranch: string | null;
  refs: Map<string, string>;
  tags: Map<string, string>;
  commits: Map<string, Commit>;
  head: string;
};

function sha(parts: string[]): string {
  let hash = 2166136261;
  const text = parts.join("\0");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").repeat(5).slice(0, 40);
}

function commitView(commit: Commit): GitCommit {
  return {
    sha: commit.sha,
    parents: [...commit.parents],
    author: commit.author,
    authorEmail: commit.authorEmail,
    authorDate: commit.date,
    subject: commit.subject,
    body: commit.body,
  };
}

function diff(before: Snapshot, after: Snapshot): GitFileChange[] {
  const names = new Set([...before.keys(), ...after.keys()]);
  const files: GitFileChange[] = [];
  for (const filename of [...names].sort()) {
    const left = before.get(filename);
    const right = after.get(filename);
    if (left === right) continue;
    const status = left === undefined ? "added" : right === undefined ? "removed" : "modified";
    const patch = [
      `diff --git a/${filename} b/${filename}`,
      `--- a/${filename}`,
      `+++ b/${filename}`,
      `@@`,
      ...(left === undefined ? [] : left.split("\n").map((line) => `-${line}`)),
      ...(right === undefined ? [] : right.split("\n").map((line) => `+${line}`)),
    ].join("\n");
    files.push({
      filename,
      status,
      additions: right ? right.split("\n").length : 0,
      deletions: left ? left.split("\n").length : 0,
      patch,
    });
  }
  return files;
}

export class MemoryGit implements GitClient {
  readonly repos = new Map<string, Repo>();
  origin: string;

  constructor(origin = "https://git.example.com") {
    this.origin = origin.replace(/\/$/, "");
  }

  private key(owner: string, name: string) {
    return `${owner}/${name}`;
  }

  private repo(owner: string, name: string): Repo | null {
    return this.repos.get(this.key(owner, name)) ?? null;
  }

  private require(owner: string, name: string): Repo {
    const repo = this.repo(owner, name);
    if (!repo) throw new GitError("Repository not found", 404);
    return repo;
  }

  private commitOf(repo: Repo, ref: string): Commit | null {
    const shaValue =
      repo.refs.get(ref) ?? repo.tags.get(ref) ?? (repo.commits.has(ref) ? ref : null);
    if (!shaValue) return null;
    return repo.commits.get(shaValue) ?? null;
  }

  async createRepository(owner: string, name: string): Promise<void> {
    const key = this.key(owner, name);
    if (this.repos.has(key)) return;
    this.repos.set(key, {
      owner,
      name,
      protectedBranch: null,
      refs: new Map(),
      tags: new Map(),
      commits: new Map(),
      head: "main",
    });
  }

  async deleteRepository(owner: string, name: string): Promise<void> {
    this.repos.delete(this.key(owner, name));
  }

  async setProtectedBranch(owner: string, name: string, branch: string): Promise<void> {
    this.require(owner, name).protectedBranch = branch;
  }

  async summary(owner: string, name: string) {
    const repo = this.repo(owner, name);
    if (!repo) return null;
    const headSha = repo.refs.get(repo.head) ?? null;
    return {
      owner,
      name,
      head: headSha ? { name: repo.head, sha: headSha } : null,
      branches: repo.refs.size,
      tags: repo.tags.size,
      cloneUrl: `${this.origin}/${owner}/${name}.git`,
    };
  }

  async tree(owner: string, name: string, ref: string, path: string) {
    const repo = this.repo(owner, name);
    if (!repo) return null;
    const commit = this.commitOf(repo, ref);
    if (!commit) return null;
    const prefix = path.replace(/^\/+|\/+$/g, "");
    const entries = new Map<string, { type: "blob" | "tree"; sha: string; size: number }>();
    for (const [file, contents] of commit.tree) {
      if (prefix && file !== prefix && !file.startsWith(`${prefix}/`)) continue;
      const rest = prefix ? file.slice(prefix.length + 1) : file;
      if (!rest || rest.startsWith("/")) continue;
      const slash = rest.indexOf("/");
      if (slash === -1) {
        entries.set(rest, { type: "blob", sha: sha([contents]), size: contents.length });
      } else {
        const dir = rest.slice(0, slash);
        if (!entries.has(dir)) entries.set(dir, { type: "tree", sha: sha([dir]), size: -1 });
      }
    }
    const readmeName = [...commit.tree.keys()].find((file) => {
      const base = file.split("/").at(-1)?.toLowerCase();
      return (
        (prefix
          ? file.startsWith(`${prefix}/`) && !file.slice(prefix.length + 1).includes("/")
          : !file.includes("/")) &&
        (base === "readme.md" || base === "readme")
      );
    });
    return {
      ref,
      sha: commit.sha,
      path: prefix,
      entries: [...entries.entries()]
        .sort((left, right) => {
          if (left[1].type !== right[1].type) return left[1].type === "tree" ? -1 : 1;
          return left[0] < right[0] ? -1 : 1;
        })
        .map(([entryName, entry]) => ({
          name: entryName,
          type: entry.type,
          mode: entry.type === "tree" ? "040000" : "100644",
          size: entry.size,
          sha: entry.sha,
        })),
      commit: commitView(commit),
      readme: readmeName
        ? {
            name: readmeName.split("/").at(-1) ?? readmeName,
            contents: commit.tree.get(readmeName) ?? "",
          }
        : null,
    };
  }

  async blob(owner: string, name: string, ref: string, path: string) {
    const repo = this.repo(owner, name);
    if (!repo) return null;
    const commit = this.commitOf(repo, ref);
    if (!commit) return null;
    const contents = commit.tree.get(path.replace(/^\/+|\/+$/g, ""));
    if (contents === undefined) return null;
    return {
      ref,
      sha: commit.sha,
      path,
      name: path.split("/").at(-1) ?? path,
      size: contents.length,
      contents,
      binary: false,
    };
  }

  async commits(owner: string, name: string, ref: string, skip: number, limit: number) {
    const repo = this.repo(owner, name);
    if (!repo) return null;
    const start = this.commitOf(repo, ref);
    if (!start) return null;
    const history: Commit[] = [];
    let current: Commit | null = start;
    while (current) {
      history.push(current);
      const parentSha: string | undefined = current.parents[0];
      current = parentSha ? (repo.commits.get(parentSha) ?? null) : null;
    }
    const page = history.slice(skip, skip + limit);
    return { sha: start.sha, commits: page.map(commitView), more: skip + limit < history.length };
  }

  async commit(owner: string, name: string, rev: string) {
    const repo = this.repo(owner, name);
    if (!repo) return null;
    const commit = this.commitOf(repo, rev);
    if (!commit) return null;
    const parent = commit.parents[0] ? repo.commits.get(commit.parents[0]) : undefined;
    const files = diff(parent?.tree ?? new Map(), commit.tree);
    return {
      commit: commitView(commit),
      stats: files.map(({ filename, additions, deletions }) => ({
        path: filename,
        additions,
        deletions,
      })),
      patch: files.map((file) => file.patch).join("\n"),
    };
  }

  async branches(owner: string, name: string) {
    const repo = this.repo(owner, name);
    if (!repo) return [];
    return [...repo.refs.entries()].map(([entryName, entrySha]) => ({
      name: entryName,
      sha: entrySha,
    }));
  }

  async tags(owner: string, name: string) {
    const repo = this.repo(owner, name);
    if (!repo) return [];
    return [...repo.tags.entries()].map(([entryName, entrySha]) => ({
      name: entryName,
      sha: entrySha,
    }));
  }

  async resolve(owner: string, name: string, ref: string) {
    const repo = this.repo(owner, name);
    if (!repo) return null;
    return this.commitOf(repo, ref)?.sha ?? null;
  }

  async compare(
    owner: string,
    name: string,
    base: string,
    head: string,
  ): Promise<GitCompare | null> {
    const repo = this.repo(owner, name);
    if (!repo) return null;
    const baseCommit = this.commitOf(repo, base);
    const headCommit = this.commitOf(repo, head);
    if (!baseCommit || !headCommit) return null;
    const files = diff(baseCommit.tree, headCommit.tree);
    return {
      baseSha: baseCommit.sha,
      headSha: headCommit.sha,
      mergeable: mergesCleanly(repo, baseCommit, headCommit),
      files,
      patch: files.map((file) => file.patch).join("\n"),
    };
  }

  /**
   * Test helper. Production pushes go through Git Smart HTTP.
   * The protected branch rejects updates that are not the merge principal.
   */
  commitFiles(input: {
    owner: string;
    repo: string;
    branch: string;
    message: string;
    files: Record<string, string | null>;
    principal?: string;
    author?: string;
    email?: string;
  }): string {
    const repo = this.require(input.owner, input.repo);
    const exists = repo.refs.has(input.branch);
    if (exists && repo.protectedBranch === input.branch && input.principal !== "svc:forgit-merge") {
      throw new GitError(`rejected by rule 'lock-${input.branch}'`, 403);
    }
    const parentSha =
      repo.refs.get(input.branch) ??
      (input.branch === repo.head ? undefined : repo.refs.get(repo.head));
    const parent = parentSha ? repo.commits.get(parentSha) : undefined;
    const tree: Snapshot = new Map(parent?.tree ?? []);
    for (const [path, contents] of Object.entries(input.files)) {
      if (contents === null) tree.delete(path);
      else tree.set(path, contents);
    }
    const subject = input.message.split("\n")[0] ?? input.message;
    const body = input.message.split("\n").slice(1).join("\n").trim();
    const commit: Commit = {
      sha: sha([
        input.branch,
        input.message,
        [...tree.entries()].map(([path, contents]) => `${path}:${contents}`).join("|"),
        parentSha ?? "",
      ]),
      parents: parentSha ? [parentSha] : [],
      author: input.author ?? "Test",
      authorEmail: input.email ?? "test@example.com",
      date: new Date().toISOString(),
      subject,
      body,
      tree,
    };
    repo.commits.set(commit.sha, commit);
    repo.refs.set(input.branch, commit.sha);
    if (!repo.refs.has(repo.head)) repo.head = input.branch;
    return commit.sha;
  }

  tag(owner: string, name: string, tag: string, shaValue: string) {
    const repo = this.require(owner, name);
    if (!repo.commits.has(shaValue)) throw new GitError("Unknown object", 404);
    repo.tags.set(tag, shaValue);
  }

  async squashMerge(input: SquashMergeInput): Promise<{ sha: string }> {
    const repo = this.require(input.owner, input.repo);
    const base = this.commitOf(repo, input.baseRef);
    const head = this.commitOf(repo, input.headRef);
    if (!base || !head) throw new GitError("Ref not found", 404);
    if (base.sha !== input.expectedBaseSha || head.sha !== input.expectedHeadSha) {
      throw new GitError("Expected SHAs do not match the current refs", 409);
    }
    const shaValue = this.commitFiles({
      owner: input.owner,
      repo: input.repo,
      branch: input.baseRef,
      message: input.message,
      files: Object.fromEntries(head.tree),
      principal: "svc:forgit-merge",
      author: input.authorName,
      email: input.authorEmail,
    });
    return { sha: shaValue };
  }

  async createBranch(input: { owner: string; repo: string; branch: string; fromRef: string }) {
    const repo = this.require(input.owner, input.repo);
    const commit = this.commitOf(repo, input.fromRef);
    if (!commit) throw new GitError("Ref not found", 404);
    if (repo.refs.has(input.branch)) throw new GitError("Branch already exists", 409);
    repo.refs.set(input.branch, commit.sha);
    return { sha: commit.sha };
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
    const commitSha = this.commitFiles({
      owner: input.owner,
      repo: input.repo,
      branch: input.branch,
      message: input.message,
      files: { [input.path]: input.contents },
      author: input.authorName,
      email: input.authorEmail,
    });
    return { commitSha };
  }
}

function mergesCleanly(repo: Repo, base: Commit, head: Commit): boolean {
  const ancestor = commonAncestor(repo, base, head);
  if (!ancestor) return base.sha === head.sha;
  const paths = new Set<string>([
    ...ancestor.tree.keys(),
    ...base.tree.keys(),
    ...head.tree.keys(),
  ]);
  for (const path of paths) {
    const origin = ancestor.tree.get(path);
    const left = base.tree.get(path);
    const right = head.tree.get(path);
    if (left !== origin && right !== origin && left !== right) return false;
  }
  return true;
}

function commonAncestor(repo: Repo, left: Commit, right: Commit): Commit | null {
  const leftSide = new Set<string>();
  const queue = [left.sha];
  while (queue.length > 0) {
    const sha = queue.shift();
    if (!sha || leftSide.has(sha)) continue;
    leftSide.add(sha);
    const commit = repo.commits.get(sha);
    if (commit) queue.push(...commit.parents);
  }
  const seen = new Set<string>();
  const fromRight = [right.sha];
  while (fromRight.length > 0) {
    const sha = fromRight.shift();
    if (!sha || seen.has(sha)) continue;
    if (leftSide.has(sha)) return repo.commits.get(sha) ?? null;
    seen.add(sha);
    const commit = repo.commits.get(sha);
    if (commit) fromRight.push(...commit.parents);
  }
  return null;
}
