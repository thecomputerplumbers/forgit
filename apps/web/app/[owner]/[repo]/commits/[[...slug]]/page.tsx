import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { RepoNav, Shell } from "@/components/shell";
import { requireOrganization } from "@/lib/session";

export default async function CommitsPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; slug?: string[] }>;
}) {
  const { owner, repo: name, slug } = await params;
  const { services, actor, user } = await requireOrganization();
  const loaded = await services.requireRepo(actor, owner, name, "read").catch(() => null);
  if (!loaded) notFound();
  const ref = slug?.[0] ?? loaded.repo.defaultBranch;
  const page = await services.git.commits(owner, name, ref, 0, 40);
  const host = (await headers()).get("host") ?? owner;
  return (
    <Shell host={host} login={user.login}>
      <div className="sheet-head">
        <h1>Commits</h1>
        <p className="muted">{ref}</p>
      </div>
      <RepoNav owner={owner} name={name} current="Commits" />
      {page?.commits.map((commit) => (
        <a className="row" href={`/${owner}/${name}/commit/${commit.sha}`} key={commit.sha}>
          <span>{commit.subject}</span>
          <span className="muted">{commit.author}</span>
          <span className="sha">{commit.sha.slice(0, 10)}</span>
        </a>
      ))}
      {!page?.commits.length ? <p className="pad">No commits on this ref.</p> : null}
    </Shell>
  );
}
