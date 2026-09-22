import { headers } from "next/headers";

import { Shell } from "@/components/shell";
import { requireOrganization } from "@/lib/session";

export default async function HomePage() {
  const { services, actor, user, organization } = await requireOrganization();
  const repos = (await services.listVisibleRepositories(actor)).filter(
    (repo) => repo.owner === organization.slug,
  );
  const host = (await headers()).get("host") ?? "forgit";
  return (
    <Shell host={host} login={user.login}>
      <div className="sheet-head">
        <h1>{organization.name}</h1>
        <p className="muted">Repositories on this forgit instance.</p>
      </div>
      {repos.length === 0 ? (
        <p className="pad">No repositories yet. Create one when you are ready to push.</p>
      ) : null}
      {repos.map((repo) => (
        <a className="row" href={`/${repo.owner}/${repo.name}`} key={repo.id}>
          <strong>
            {repo.owner}/{repo.name}
          </strong>
          <span>{repo.description}</span>
          <span className="sha">{repo.archived ? "archived" : repo.visibility}</span>
        </a>
      ))}
    </Shell>
  );
}
