import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { RepoNav, Shell } from "@/components/shell";
import { loadGit } from "@/lib/git-view";
import { resolveSlug } from "@/lib/ref-path";
import { requireOrganization } from "@/lib/session";

export default async function TreePage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; slug: string[] }>;
}) {
  const { owner, repo: name, slug } = await params;
  const { services, actor, user } = await requireOrganization();
  const loaded = await services.requireRepo(actor, owner, name, "read").catch(() => null);
  if (!loaded) notFound();
  const { ref, path } = await resolveSlug(
    services.git,
    owner,
    name,
    slug,
    loaded.repo.defaultBranch,
  );
  const listed = await loadGit(() => services.git.tree(owner, name, ref, path));
  if ("message" in listed) {
    const host = (await headers()).get("host") ?? owner;
    return (
      <Shell host={host} login={user.login}>
        <div className="sheet-head">
          <h1>{path || name}</h1>
        </div>
        <RepoNav owner={owner} name={name} current="Code" />
        <p className="error">{listed.message}</p>
      </Shell>
    );
  }
  const tree = listed.value;
  if (!tree) notFound();
  const host = (await headers()).get("host") ?? owner;
  return (
    <Shell host={host} login={user.login}>
      <div className="sheet-head">
        <h1>{path || name}</h1>
        <p className="sha">
          {ref} {tree.sha.slice(0, 12)}
        </p>
      </div>
      <RepoNav owner={owner} name={name} current="Code" />
      {tree.entries.map((entry) => {
        const next = path ? `${path}/${entry.name}` : entry.name;
        const href =
          entry.type === "tree"
            ? `/${owner}/${name}/tree/${ref}/${next}`
            : `/${owner}/${name}/blob/${ref}/${next}`;
        return (
          <a className="file" href={href} key={entry.name}>
            <span>{entry.type}</span>
            <span>{entry.name}</span>
            <span />
          </a>
        );
      })}
    </Shell>
  );
}
