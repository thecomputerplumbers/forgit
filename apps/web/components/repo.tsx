import type { GitCommit, GitEntry } from "@forgit/git-client";
import type { PullRequest, Repository } from "@forgit/domain";

import { formatBytes } from "@/lib/format";
import { animalFor } from "@/lib/themes";

import { ListFilter } from "./client";
import { Icon, type IconName } from "./icons";
import { Avatar, Badge, Sha, TimeAgo } from "./ui";

export const PULL_ICON: Record<PullRequest["state"], IconName> = {
  open: "pull",
  merged: "merge",
  closed: "pullClosed",
};

export type RepoTab = "Code" | "Pull requests" | "Commits" | "Branches" | "Tags" | "Settings";

const TABS: Array<[RepoTab, IconName, string]> = [
  ["Code", "code", ""],
  ["Pull requests", "pull", "/pulls"],
  ["Commits", "history", "/commits"],
  ["Branches", "branch", "/branches"],
  ["Tags", "tag", "/tags"],
  ["Settings", "gear", "/settings"],
];

export function RepoHeader({
  repo,
  owner,
  current,
  openPulls,
}: {
  repo: Repository;
  owner: string;
  current: RepoTab;
  openPulls?: number;
}) {
  const base = `/${owner}/${repo.name}`;
  return (
    <div className="repo-header">
      <div className="container">
        <div className="repo-title">
          <Icon name="book" size={18} />
          <span aria-hidden="true" className="repo-mascot">
            {animalFor(repo.name)}
          </span>
          <a href="/">{owner}</a>
          <span className="repo-title-sep">/</span>
          <a className="repo-title-name" href={base}>
            {repo.name}
          </a>
          <Badge icon={repo.visibility === "public" ? "globe" : "lock"}>
            {repo.visibility === "public" ? "Public" : "Private"}
          </Badge>
          {repo.archived ? (
            <Badge icon="archive" tone="warning">
              Archived
            </Badge>
          ) : null}
        </div>
        <nav aria-label="Repository" className="tabs">
          {TABS.map(([label, icon, suffix]) => (
            <a
              aria-current={label === current ? "page" : undefined}
              href={`${base}${suffix}`}
              key={label}
            >
              <Icon name={icon} />
              {label}
              {label === "Pull requests" && openPulls ? (
                <span className="counter">{openPulls}</span>
              ) : null}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}

/** A dependency-free dropdown built on details/summary. */
export function RefPicker({
  current,
  branches,
  tags = [],
  hrefFor,
}: {
  current: string;
  branches: string[];
  tags?: string[];
  hrefFor: (ref: string) => string;
}) {
  const isTag = tags.includes(current) && !branches.includes(current);
  return (
    <details className="menu ref-picker">
      <summary className="btn btn-sm">
        <Icon name={isTag ? "tag" : "branch"} />
        <span className="ref-picker-name">{current}</span>
        <Icon name="chevronDown" size={14} />
      </summary>
      <div className="menu-panel menu-panel-left">
        <div className="menu-heading">
          <strong>Switch branches or tags</strong>
        </div>
        {branches.length + tags.length > 8 ? (
          <div style={{ padding: "0 4px 6px" }}>
            <ListFilter placeholder="Find a branch or tag…" target="ref-picker-list" />
          </div>
        ) : null}
        <div className="menu-scroll" id="ref-picker-list">
          {branches.map((branch) => (
            <a
              aria-current={branch === current ? "true" : undefined}
              className="menu-item"
              data-filter={branch}
              href={hrefFor(branch)}
              key={`b-${branch}`}
            >
              <Icon name={branch === current ? "check" : "branch"} />
              {branch}
            </a>
          ))}
          {tags.length ? (
            // Matches any tag name, so the heading hides when the filter hides every tag.
            <div className="menu-label" data-filter={tags.join("\n")}>
              Tags
            </div>
          ) : null}
          {tags.map((tag) => (
            <a
              aria-current={tag === current ? "true" : undefined}
              className="menu-item"
              data-filter={tag}
              href={hrefFor(tag)}
              key={`t-${tag}`}
            >
              <Icon name={tag === current ? "check" : "tag"} />
              {tag}
            </a>
          ))}
          {branches.length + tags.length === 0 ? (
            <div className="menu-label">No refs yet</div>
          ) : null}
        </div>
      </div>
    </details>
  );
}

export function PathCrumbs({
  owner,
  name,
  refName,
  path,
}: {
  owner: string;
  name: string;
  refName: string;
  path: string;
}) {
  const parts = path ? path.split("/") : [];
  return (
    <nav aria-label="Path" className="crumbs">
      <a href={`/${owner}/${name}/tree/${refName}`}>{name}</a>
      {parts.map((part, index) => {
        const last = index === parts.length - 1;
        const href = `/${owner}/${name}/tree/${refName}/${parts.slice(0, index + 1).join("/")}`;
        return (
          <span key={href}>
            <span className="crumbs-sep">/</span>
            {last ? <strong>{part}</strong> : <a href={href}>{part}</a>}
          </span>
        );
      })}
    </nav>
  );
}

export function LatestCommit({
  commit,
  owner,
  name,
  historyHref,
}: {
  commit: GitCommit;
  owner: string;
  name: string;
  historyHref: string;
}) {
  return (
    <div className="latest-commit">
      <Avatar name={commit.author} size={22} />
      <strong className="latest-author">{commit.author}</strong>
      <a className="latest-subject" href={`/${owner}/${name}/commit/${commit.sha}`}>
        {commit.subject}
      </a>
      <span className="latest-meta">
        <Sha href={`/${owner}/${name}/commit/${commit.sha}`} sha={commit.sha} />
        <span className="hide-sm">
          <TimeAgo value={commit.authorDate} />
        </span>
        <a className="btn btn-sm btn-ghost" href={historyHref}>
          <Icon name="history" /> <span className="hide-sm">History</span>
        </a>
      </span>
    </div>
  );
}

export function FileList({
  entries,
  owner,
  name,
  refName,
  path,
}: {
  entries: GitEntry[];
  owner: string;
  name: string;
  refName: string;
  path: string;
}) {
  const sorted = [...entries].sort((left, right) => {
    const rank = (entry: GitEntry) => (entry.type === "tree" ? 0 : 1);
    return rank(left) - rank(right) || left.name.localeCompare(right.name);
  });
  const parent = path.split("/").slice(0, -1).join("/");
  return (
    <ul className="files">
      {path ? (
        <li>
          <a
            className="file-row"
            href={`/${owner}/${name}/tree/${refName}${parent ? `/${parent}` : ""}`}
          >
            <Icon name="folder" className="icon file-icon-dir" />
            <span className="file-name">..</span>
          </a>
        </li>
      ) : null}
      {sorted.map((entry) => {
        const next = path ? `${path}/${entry.name}` : entry.name;
        const kind = entry.type === "tree" ? "tree" : "blob";
        const icon: IconName =
          entry.type === "tree" ? "folder" : entry.type === "commit" ? "submodule" : "file";
        return (
          <li key={entry.name}>
            <a className="file-row" href={`/${owner}/${name}/${kind}/${refName}/${next}`}>
              <Icon
                className={entry.type === "tree" ? "icon file-icon-dir" : "icon file-icon"}
                name={icon}
              />
              <span className="file-name">{entry.name}</span>
              <span className="file-size">
                {entry.type === "blob" ? formatBytes(entry.size) : ""}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
