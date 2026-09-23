import type { ReactNode } from "react";

import type { GitTree } from "@forgit/git-client";

import { Icon } from "@/components/icons";
import { Markdown } from "@/components/markdown";
import { FileList, LatestCommit, PathCrumbs, RefPicker } from "@/components/repo";
import { Alert, Box } from "@/components/ui";

/** File browser shared by the repository root and tree pages. */
export function CodeBrowser({
  owner,
  name,
  refName,
  path,
  branches,
  tags,
  tree,
  error,
  aside,
}: {
  owner: string;
  name: string;
  refName: string;
  path: string;
  branches: string[];
  tags: string[];
  tree: GitTree | null;
  error: string | null;
  aside?: ReactNode;
}) {
  const main = (
    <div className="stack">
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <RefPicker
          branches={branches}
          current={refName}
          hrefFor={(ref) => `/${owner}/${name}/tree/${ref}${path ? `/${path}` : ""}`}
          tags={tags}
        />
        {path ? <PathCrumbs name={name} owner={owner} path={path} refName={refName} /> : null}
        <span className="spacer" />
        <a className="btn btn-sm btn-ghost" href={`/${owner}/${name}/commits/${refName}`}>
          <Icon name="history" /> Commits
        </a>
      </div>
      {error ? <Alert title="Git storage did not answer">{error}</Alert> : null}
      {tree ? (
        <Box flush>
          {tree.commit ? (
            <LatestCommit
              commit={tree.commit}
              historyHref={`/${owner}/${name}/commits/${refName}`}
              name={name}
              owner={owner}
            />
          ) : null}
          <FileList
            entries={tree.entries}
            name={name}
            owner={owner}
            path={path}
            refName={refName}
          />
        </Box>
      ) : null}
      {tree?.readme ? (
        <Box
          title={
            <span className="readme-head">
              <Icon name="book" /> {tree.readme.name}
            </span>
          }
        >
          {/\.(md|markdown)$/i.test(tree.readme.name) ? (
            <Markdown
              dir={path}
              root={`/${owner}/${name}/blob/${refName}`}
              source={tree.readme.contents}
            />
          ) : (
            <pre className="commit-body" style={{ margin: 0 }}>
              {tree.readme.contents}
            </pre>
          )}
        </Box>
      ) : null}
    </div>
  );
  if (!aside) return main;
  return (
    <div className="layout-sidebar">
      {main}
      <aside>{aside}</aside>
    </div>
  );
}
