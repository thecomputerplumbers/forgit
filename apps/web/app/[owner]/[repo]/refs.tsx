import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { RepoNav, Shell } from "@/components/shell";
import { requireOrganization } from "@/lib/session";

export default async function RefsPage({
  params,
  kind,
}: {
  params: Promise<{ owner: string; repo: string }>;
  kind: "branches" | "tags";
}) {
  const { owner, repo: name } = await params;
  const { services, actor, user } = await requireOrganization();
  const loaded = await services.requireRepo(actor, owner, name, "read").catch(() => null);
  if (!loaded) notFound();
  const refs =
    kind === "branches"
      ? await services.git.branches(owner, name)
      : await services.git.tags(owner, name);
  const host = (await headers()).get("host") ?? owner;
  return (
    <Shell host={host} login={user.login}>
      <div className="sheet-head">
        <h1>{kind === "branches" ? "Branches" : "Tags"}</h1>
      </div>
      <RepoNav owner={owner} name={name} current={kind === "branches" ? "Branches" : "Tags"} />
      {refs.map((ref) => (
        <a className="row" href={`/${owner}/${name}/tree/${ref.name}`} key={ref.name}>
          <span>{ref.name}</span>
          <span />
          <span className="sha">
            {ref.sha.slice(0, 12)}
            {kind === "branches" && ref.name === loaded.repo.defaultBranch ? " protected" : ""}
          </span>
        </a>
      ))}
      {refs.length === 0 ? <p className="pad">None yet.</p> : null}
    </Shell>
  );
}
