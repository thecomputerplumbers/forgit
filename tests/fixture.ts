import { createServices, MemoryStore } from "@forgit/domain";
import { MemoryGit } from "@forgit/git-client";

export async function world() {
  const store = new MemoryStore();
  store.clock = 1_700_000_000_000;
  const git = new MemoryGit("https://git.example.com");
  store.seedUser(
    { id: "alice", name: "Alice", email: "alice@example.com", login: "alice" },
    { id: "org", name: "Acme", slug: "acme", role: "owner" },
  );
  store.seedUser({ id: "bob", name: "Bob", email: "bob@example.com", login: "bob" });
  store.orgMembers.push({ organizationId: "org", userId: "bob", role: "member" });
  store.seedUser({ id: "cara", name: "Cara", email: "cara@example.com", login: "cara" });
  const services = createServices(store, git, "https://git.example.com");
  const alice = await services.actorFromUser("alice");
  const bob = await services.actorFromUser("bob");
  const cara = await services.actorFromUser("cara");
  const created = await services.createRepository(alice, {
    owner: "acme",
    name: "widget",
    description: "A widget",
  });
  await store.upsertRepoMember({ repositoryId: created.repo.id, userId: "bob", role: "write" });
  const base = git.commitFiles({
    owner: "acme",
    repo: "widget",
    branch: "main",
    message: "init",
    files: { "README.md": "hello\n" },
  });
  return { store, git, services, alice, bob, cara, repo: created.repo, base };
}
