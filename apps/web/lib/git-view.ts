import { GitError } from "@forgit/git-client";

export async function loadGit<T>(
  work: () => Promise<T>,
): Promise<{ value: T } | { message: string }> {
  try {
    return { value: await work() };
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    return { message: error.message };
  }
}
