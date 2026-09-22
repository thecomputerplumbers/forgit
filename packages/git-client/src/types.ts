export class GitError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitError";
  }
}

export type GitSummary = {
  owner: string;
  name: string;
  head: { name: string; sha: string } | null;
  branches: number;
  tags: number;
  cloneUrl: string;
};

export type GitEntry = {
  name: string;
  type: "blob" | "tree" | "commit";
  mode: string;
  size: number;
  sha: string;
};

export type GitCommit = {
  sha: string;
  parents: string[];
  author: string;
  authorEmail: string;
  authorDate: string;
  subject: string;
  body: string;
};

export type GitTree = {
  ref: string;
  sha: string;
  path: string;
  entries: GitEntry[];
  commit: GitCommit | null;
  readme: { name: string; contents: string } | null;
};

export type GitBlob = {
  ref: string;
  sha: string;
  path: string;
  name: string;
  size: number;
  contents: string | null;
  binary: boolean;
};

export type GitCommitDetail = {
  commit: GitCommit;
  stats: Array<{ path: string; additions: number; deletions: number }>;
  patch: string;
};

export type GitRef = { name: string; sha: string };

export type GitFileChange = {
  filename: string;
  status: "added" | "modified" | "removed";
  additions: number;
  deletions: number;
  patch: string;
};

export type GitCompare = {
  baseSha: string;
  headSha: string;
  mergeable: boolean;
  files: GitFileChange[];
  patch: string;
};

export type SquashMergeInput = {
  owner: string;
  repo: string;
  baseRef: string;
  headRef: string;
  expectedBaseSha: string;
  expectedHeadSha: string;
  message: string;
  authorName: string;
  authorEmail: string;
};

export interface GitClient {
  createRepository(owner: string, name: string): Promise<void>;
  deleteRepository(owner: string, name: string): Promise<void>;
  setProtectedBranch(owner: string, name: string, branch: string): Promise<void>;
  summary(owner: string, name: string): Promise<GitSummary | null>;
  tree(owner: string, name: string, ref: string, path: string): Promise<GitTree | null>;
  blob(owner: string, name: string, ref: string, path: string): Promise<GitBlob | null>;
  commits(
    owner: string,
    name: string,
    ref: string,
    skip: number,
    limit: number,
  ): Promise<{ sha: string; commits: GitCommit[]; more: boolean } | null>;
  commit(owner: string, name: string, sha: string): Promise<GitCommitDetail | null>;
  branches(owner: string, name: string): Promise<GitRef[]>;
  tags(owner: string, name: string): Promise<GitRef[]>;
  resolve(owner: string, name: string, ref: string): Promise<string | null>;
  compare(owner: string, name: string, base: string, head: string): Promise<GitCompare | null>;
  squashMerge(input: SquashMergeInput): Promise<{ sha: string }>;
  createBranch(input: {
    owner: string;
    repo: string;
    branch: string;
    fromRef: string;
  }): Promise<{ sha: string }>;
  writeFile(input: {
    owner: string;
    repo: string;
    branch: string;
    path: string;
    contents: string;
    message: string;
    authorName: string;
    authorEmail: string;
  }): Promise<{ commitSha: string }>;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function assertRepoName(value: string): string {
  if (!NAME.test(value) || value === "." || value === ".." || value.endsWith(".git")) {
    throw new GitError("Repository name is not allowed", 400);
  }
  return value;
}

const RESERVED = new Set([
  "api",
  "mcp",
  "settings",
  "new",
  "sign-in",
  "sign-up",
  "onboarding",
  "healthz",
  "readyz",
  ".well-known",
  "_forgit",
  "favicon.ico",
  "repos.js",
]);

export type Classified =
  | { kind: "git"; owner: string; repo: string; write: boolean; suffix: string }
  | { kind: "health" }
  | { kind: "ready" }
  | { kind: "app" };

/**
 * Separates Git Smart HTTP from the application.
 * A repository path never wins over a reserved application prefix.
 */
export function classifyPath(pathname: string, method: string): Classified {
  if (pathname === "/healthz") return { kind: "health" };
  if (pathname === "/readyz") return { kind: "ready" };
  const match = pathname.match(/^\/([^/]+)\/([^/]+)\.git(\/.*)?$/);
  if (!match) return { kind: "app" };
  const owner = decodeURIComponent(match[1] ?? "");
  const repo = decodeURIComponent(match[2] ?? "");
  const suffix = match[3] ?? "";
  if (RESERVED.has(owner) || !NAME.test(owner) || !NAME.test(repo)) return { kind: "app" };
  if (owner.includes("..") || repo.includes("..")) return { kind: "app" };
  const write =
    method === "POST" && (suffix === "/git-receive-pack" || suffix.startsWith("/info/lfs"));
  const allowed =
    suffix === "" ||
    suffix === "/info/refs" ||
    suffix === "/git-upload-pack" ||
    suffix === "/git-receive-pack" ||
    suffix.startsWith("/info/lfs");
  if (!allowed) return { kind: "app" };
  return { kind: "git", owner, repo, write, suffix };
}
