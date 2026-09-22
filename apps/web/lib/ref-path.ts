import { loadGit } from "./git-view.ts";

type NamedRef = { name: string };

type RefLister = {
  branches(owner: string, name: string): Promise<NamedRef[]>;
  tags(owner: string, name: string): Promise<NamedRef[]>;
};

/** Longest slug prefix that is a real branch or tag. The rest is the file path. */
export function splitRefPath(
  slug: readonly string[],
  refNames: readonly string[],
  fallback: string,
): { ref: string; path: string } {
  const known = new Set(refNames);
  for (let length = slug.length; length > 0; length -= 1) {
    const ref = slug.slice(0, length).join("/");
    if (known.has(ref)) return { ref, path: slug.slice(length).join("/") };
  }
  if (slug.length === 0) return { ref: fallback, path: "" };
  return { ref: slug[0] ?? fallback, path: slug.slice(1).join("/") };
}

export async function resolveSlug(
  git: RefLister,
  owner: string,
  name: string,
  slug: readonly string[],
  fallback: string,
) {
  const branches = await loadGit(() => git.branches(owner, name));
  const tags = await loadGit(() => git.tags(owner, name));
  const names = [
    ...("value" in branches ? branches.value : []),
    ...("value" in tags ? tags.value : []),
  ].map((ref) => ref.name);
  return splitRefPath(slug, names, fallback);
}
