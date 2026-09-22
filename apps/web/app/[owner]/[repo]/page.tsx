import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { RepoNav, Shell } from "@/components/shell";
import { requireOrganization } from "@/lib/session";

export default async function RepositoryPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo: name } = await params;
  const { services, actor, user } = await requireOrganization();
  const loaded = await services.requireRepo(actor, owner, name, "read").catch(() => null);
  if (!loaded) notFound();
  const summary = await services.git.summary(owner, name);
  const tree = summary?.head ? await services.git.tree(owner, name, summary.head.name, "") : null;
  const host = (await headers()).get("host") ?? owner;
  const clone = services.cloneUrl(owner, name);
  return (
    <Shell host={host} login={user.login}>
      <div className="sheet-head">
        <h1>
          {owner}/{name}
        </h1>
        <p className="muted">{loaded.repo.description || "No description"}</p>
      </div>
      <RepoNav owner={owner} name={name} current="Code" />
      <p className="pad clone">git clone {clone}</p>
      {!summary?.head ? (
        <div className="pad">
          <p>
            This repository has no commits yet. Push the default branch {loaded.repo.defaultBranch}{" "}
            over HTTPS.
          </p>
          <pre className="clone">{`git remote add origin ${clone}\ngit push -u origin ${loaded.repo.defaultBranch}`}</pre>
        </div>
      ) : (
        <>
          {tree?.entries.map((entry) => (
            <a
              className="file"
              href={
                entry.type === "tree"
                  ? `/${owner}/${name}/tree/${summary.head?.name}/${entry.name}`
                  : `/${owner}/${name}/blob/${summary.head?.name}/${entry.name}`
              }
              key={entry.name}
            >
              <span>{entry.type}</span>
              <span>{entry.name}</span>
              <span className="sha">{entry.type === "blob" ? `${entry.size} B` : ""}</span>
            </a>
          ))}
          {tree?.readme ? (
            <div className="pad">
              <h2>{tree.readme.name}</h2>
              <pre className="readme">{tree.readme.contents}</pre>
            </div>
          ) : null}
        </>
      )}
    </Shell>
  );
}
