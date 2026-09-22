import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { RepoNav, Shell } from "@/components/shell";
import { loadGit } from "@/lib/git-view";
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
  const summaryResult = await loadGit(() => services.git.summary(owner, name));
  const summary = "value" in summaryResult ? summaryResult.value : null;
  const treeResult = summary?.head
    ? await loadGit(() => services.git.tree(owner, name, summary.head?.name ?? "", ""))
    : null;
  const tree = treeResult && "value" in treeResult ? treeResult.value : null;
  const gitMessage =
    "message" in summaryResult
      ? summaryResult.message
      : treeResult && "message" in treeResult
        ? treeResult.message
        : null;
  const host = (await headers()).get("host") ?? owner;
  const clone = services.cloneUrl(owner, name);
  const authed = clone.replace("://", "://git@");
  return (
    <Shell host={host} login={user.login}>
      <div className="sheet-head">
        <h1>
          {owner}/{name}
        </h1>
        <p className="muted">{loaded.repo.description || "No description"}</p>
      </div>
      <RepoNav owner={owner} name={name} current="Code" />
      <p className="pad clone">git clone {authed}</p>
      <p className="pad muted">When Git asks for a password, paste a personal access token.</p>
      {gitMessage ? <p className="error">{gitMessage}</p> : null}
      {!gitMessage && !summary?.head ? (
        <div className="pad">
          <p>
            This repository has no commits yet. Push the default branch {loaded.repo.defaultBranch}{" "}
            over HTTPS.
          </p>
          <pre className="clone">{`git remote add origin ${authed}\ngit push -u origin ${loaded.repo.defaultBranch}`}</pre>
        </div>
      ) : summary?.head ? (
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
      ) : null}
    </Shell>
  );
}
