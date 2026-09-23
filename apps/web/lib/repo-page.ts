import { notFound } from "next/navigation";

import { requireOrganization } from "./session.ts";

/** Session, organization, and read access for a repository page, or a 404. */
export async function loadRepoPage(owner: string, name: string) {
  const context = await requireOrganization();
  const loaded = await context.services
    .requireRepo(context.actor, owner, name, "read")
    .catch(() => null);
  if (!loaded) notFound();
  return { ...context, repo: loaded.repo, role: loaded.actual };
}

/** Display names for a set of user ids, fetched once each. */
export async function loadLogins(
  store: { getUser(id: string): Promise<{ id: string; login: string } | null> },
  ids: Iterable<string>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const users = await Promise.all(unique.map((id) => store.getUser(id)));
  return new Map(unique.map((id, index) => [id, users[index]?.login ?? "unknown"]));
}
