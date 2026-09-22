import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { Patch, RepoNav, Shell } from "@/components/shell";
import { loadGit } from "@/lib/git-view";
import { requireOrganization } from "@/lib/session";

export default async function CommitPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; sha: string }>;
}) {
  const { owner, repo: name, sha } = await params;
  const { services, actor, user } = await requireOrganization();
  const loaded = await services.requireRepo(actor, owner, name, "read").catch(() => null);
  if (!loaded) notFound();
  const listed = await loadGit(() => services.git.commit(owner, name, sha));
  if ("message" in listed) {
    const host = (await headers()).get("host") ?? owner;
    return (
      <Shell host={host} login={user.login}>
        <div className="sheet-head">
          <h1>{sha}</h1>
        </div>
        <RepoNav owner={owner} name={name} current="Commits" />
        <p className="error">{listed.message}</p>
      </Shell>
    );
  }
  const detail = listed.value;
  if (!detail) notFound();
  const host = (await headers()).get("host") ?? owner;
  return (
    <Shell host={host} login={user.login}>
      <div className="sheet-head">
        <h1>{detail.commit.subject}</h1>
        <p className="muted">
          {detail.commit.author} · <span className="sha">{detail.commit.sha}</span>
        </p>
        {detail.commit.body ? <pre className="readme">{detail.commit.body}</pre> : null}
      </div>
      <RepoNav owner={owner} name={name} current="Commits" />
      <Patch patch={detail.patch} />
    </Shell>
  );
}
