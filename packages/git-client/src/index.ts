export { GitError, assertRepoName, classifyPath } from "./types.ts";
export type {
  Classified,
  GitBlob,
  GitClient,
  GitCommit,
  GitCommitDetail,
  GitCompare,
  GitFileChange,
  GitRef,
  GitSummary,
  GitTree,
  SquashMergeInput,
} from "./types.ts";
export { MemoryGit } from "./memory.ts";
export { HttpGitClient } from "./http.ts";
export type { HttpGitOptions } from "./http.ts";

import type { GitClient } from "./types.ts";

/**
 * walgit's compare is a git operation. When the HTTP client has no compare
 * endpoint, callers fall back to commit patches. This wrapper keeps the
 * interface honest for the memory double used in tests.
 */
export function clientSupportsCompare(client: GitClient): boolean {
  return client.constructor.name === "MemoryGit";
}
