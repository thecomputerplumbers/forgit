import { notFound } from "next/navigation";

import { RepoHeader } from "@/components/repo";
import { Shell } from "@/components/shell";
import { loadGit } from "@/lib/git-view";
import { resolveSlug } from "@/lib/ref-path";
import { loadRepoPage } from "@/lib/repo-page";

import { CodeBrowser } from "../../code";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string; slug: string[] }>;
}) {
  const { owner, repo, slug } = await params;
  return { title: `${slug.slice(1).join("/") || slug[0]} · ${owner}/${repo}` };
}

export default async function TreePage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; slug: string[] }>;
}) {
  const { owner, repo: name, slug } = await params;
  const { services, user, organization, repo } = await loadRepoPage(owner, name);
  const { ref, path, branches, tags } = await resolveSlug(
    services.git,
    owner,
    name,
    slug,
    repo.defaultBranch,
  );
  const listed = await loadGit(() => services.git.tree(owner, name, ref, path));
  if ("value" in listed && !listed.value) notFound();
  return (
    <Shell organization={organization} user={user}>
      <RepoHeader current="Code" owner={owner} repo={repo} />
      <div className="container page">
        <CodeBrowser
          branches={branches}
          error={"message" in listed ? listed.message : null}
          name={name}
          owner={owner}
          path={path}
          refName={ref}
          tags={tags}
          tree={"value" in listed ? listed.value : null}
        />
      </div>
    </Shell>
  );
}
