import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { RepoNav, Shell } from "@/components/shell";
import { loadGit } from "@/lib/git-view";
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
  const listed = await loadGit(() => services.git.commits(owner, name, ref, 0, 40));
  const page = "value" in listed ? listed.value : null;
  const host = (await headers()).get("host") ?? owner;
  return (
    <Shell host={host} login={user.login}>
      <div className="sheet-head">
        <h1>Commits</h1>
        <p className="muted">{ref}</p>
      </div>
      <RepoNav owner={owner} name={name} current="Commits" />
      {"message" in listed ? <p className="error">{listed.message}</p> : null}
      {page?.commits.map((commit) => (
        <a className="row" href={`/${owner}/${name}/commit/${commit.sha}`} key={commit.sha}>
          <span>{commit.subject}</span>
          <span className="muted">{commit.author}</span>
          <span className="sha">{commit.sha.slice(0, 10)}</span>
        </a>
      ))}
      {"message" in listed || page?.commits.length ? null : (
        <p className="pad">No commits on this ref.</p>
      )}
    </Shell>
  );
}
