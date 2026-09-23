import { notFound } from "next/navigation";

import { CopyButton } from "@/components/client";
import { Tokens } from "@/components/code";
import { Icon } from "@/components/icons";
import { Markdown } from "@/components/markdown";
import { PathCrumbs, RefPicker, RepoHeader } from "@/components/repo";
import { Shell } from "@/components/shell";
import { Alert, Box, EmptyState } from "@/components/ui";
import { formatBytes, plural } from "@/lib/format";
import { loadGit } from "@/lib/git-view";
import { highlightLines, languageForPath } from "@/lib/highlight";
import { resolveSlug } from "@/lib/ref-path";
import { loadRepoPage } from "@/lib/repo-page";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string; slug: string[] }>;
}) {
  const { owner, repo, slug } = await params;
  return { title: `${slug.at(-1)} · ${owner}/${repo}` };
}

export default async function BlobPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string; slug: string[] }>;
  searchParams: Promise<{ plain?: string }>;
}) {
  const { owner, repo: name, slug } = await params;
  const { plain } = await searchParams;
  const { services, user, organization, repo } = await loadRepoPage(owner, name);
  const { ref, path, branches, tags } = await resolveSlug(
    services.git,
    owner,
    name,
    slug,
    repo.defaultBranch,
  );
  const listed = await loadGit(() => services.git.blob(owner, name, ref, path));
  if ("value" in listed && !listed.value) notFound();
  const blob = "value" in listed ? listed.value : null;
  const lines = blob?.contents
    ? highlightLines(blob.contents.replace(/\n$/, ""), languageForPath(path))
    : [];
  const markdown = /\.(md|markdown)$/i.test(path);
  const preview = markdown && plain !== "1";
  const dir = path.split("/").slice(0, -1).join("/");
  const self = `/${owner}/${name}/blob/${ref}/${path}`;
  return (
    <Shell organization={organization} user={user}>
      <RepoHeader current="Code" owner={owner} repo={repo} />
      <div className="container page">
        <div className="toolbar">
          <RefPicker
            branches={branches}
            current={ref}
            hrefFor={(next) => `/${owner}/${name}/blob/${next}/${path}`}
            tags={tags}
          />
          <PathCrumbs name={name} owner={owner} path={path} refName={ref} />
          <span className="spacer" />
          <CopyButton label="Copy path" value={path} />
        </div>
        {"message" in listed ? (
          <Alert title="Git storage did not answer">{listed.message}</Alert>
        ) : null}
        {blob ? (
          <Box
            actions={
              markdown ? (
                <nav aria-label="View" className="segmented">
                  <a aria-current={preview ? "page" : undefined} href={self}>
                    <Icon name="eye" /> Preview
                  </a>
                  <a aria-current={preview ? undefined : "page"} href={`${self}?plain=1`}>
                    <Icon name="code" /> Code
                  </a>
                </nav>
              ) : blob.contents !== null ? (
                <CopyButton label="Copy file contents" value={blob.contents} />
              ) : null
            }
            flush
            title={
              <span className="blob-head">
                {blob.contents !== null ? <span>{plural(lines.length, "line")}</span> : null}
                <span>{formatBytes(blob.size)}</span>
                <code className="sha-chip" title={blob.sha}>
                  {blob.sha.slice(0, 7)}
                </code>
              </span>
            }
          >
            {blob.contents === null ? (
              <EmptyState icon="file" title="Binary file">
                This file is {formatBytes(blob.size)} and can't be shown as text.
              </EmptyState>
            ) : preview ? (
              <div style={{ padding: "24px 32px" }}>
                <Markdown dir={dir} root={`/${owner}/${name}/blob/${ref}`} source={blob.contents} />
              </div>
            ) : (
              <div className="code-scroll">
                <table className="code-table">
                  <tbody>
                    {lines.map((line, index) => (
                      <tr id={`L${index + 1}`} key={index}>
                        <td className="ln">
                          <a href={`#L${index + 1}`}>{index + 1}</a>
                        </td>
                        <td>
                          <Tokens tokens={line} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Box>
        ) : null}
      </div>
    </Shell>
  );
}
