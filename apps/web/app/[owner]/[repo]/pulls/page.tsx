import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { openPullAction } from "@/app/actions";
import { RepoNav, Shell } from "@/components/shell";
import { requireOrganization } from "@/lib/session";

export default async function PullsPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { owner, repo: name } = await params;
  const { error } = await searchParams;
  const { services, actor, user } = await requireOrganization();
  const loaded = await services.requireRepo(actor, owner, name, "read").catch(() => null);
  if (!loaded) notFound();
  const pulls = await services.store.listPullRequests(loaded.repo.id, "all");
  const host = (await headers()).get("host") ?? owner;
  return (
    <Shell host={host} login={user.login}>
      <div className="sheet-head">
        <h1>Pull requests</h1>
      </div>
      <RepoNav owner={owner} name={name} current="Pulls" />
      {error ? <p className="error">{error}</p> : null}
      {pulls.map((pull) => (
        <a className="row" href={`/${owner}/${name}/pull/${pull.number}`} key={pull.id}>
          <span>{pull.title}</span>
          <span className={`state-${pull.state}`}>{pull.state}</span>
          <span className="sha">#{pull.number}</span>
        </a>
      ))}
      <form action={openPullAction} className="stack">
        <h2>Open a pull request</h2>
        <input type="hidden" name="owner" value={owner} />
        <input type="hidden" name="repo" value={name} />
        <label>
          Title
          <input name="title" required />
        </label>
        <label>
          Body
          <textarea name="body" />
        </label>
        <label>
          Head branch
          <input name="head" required placeholder="feature" />
        </label>
        <label>
          Base branch
          <input name="base" defaultValue={loaded.repo.defaultBranch} />
        </label>
        <button type="submit">Open pull request</button>
      </form>
    </Shell>
  );
}
