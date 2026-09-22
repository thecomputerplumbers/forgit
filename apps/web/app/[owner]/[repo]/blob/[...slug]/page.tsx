import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { RepoNav, Shell } from "@/components/shell";
import { requireOrganization } from "@/lib/session";

export default async function BlobPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; slug: string[] }>;
}) {
  const { owner, repo: name, slug } = await params;
  const { services, actor, user } = await requireOrganization();
  const loaded = await services.requireRepo(actor, owner, name, "read").catch(() => null);
  if (!loaded) notFound();
  const ref = slug[0] ?? loaded.repo.defaultBranch;
  const path = slug.slice(1).join("/");
  const blob = await services.git.blob(owner, name, ref, path);
  if (!blob) notFound();
  const host = (await headers()).get("host") ?? owner;
  return (
    <Shell host={host} login={user.login}>
      <div className="sheet-head">
        <h1>{blob.name}</h1>
        <p className="sha">
          {path} · {blob.size} bytes
        </p>
      </div>
      <RepoNav owner={owner} name={name} current="Code" />
      {blob.contents ? (
        <pre className="pad readme">{blob.contents}</pre>
      ) : (
        <p className="pad">Binary file.</p>
      )}
    </Shell>
  );
}
