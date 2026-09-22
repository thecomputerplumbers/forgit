import type { ReactNode } from "react";

export function Shell({
  host,
  login,
  children,
}: {
  host: string;
  login?: string;
  children: ReactNode;
}) {
  return (
    <div className="app">
      <header className="top">
        <a className="nameplate" href="/">
          forgit
        </a>
        <span className="host">{host}</span>
        <nav>
          <a href="/new">New repository</a>
          <a href="/settings/tokens">Tokens</a>
          <a href="/settings/members">Members</a>
          {login ? <span className="who">{login}</span> : <a href="/sign-in">Sign in</a>}
        </nav>
      </header>
      <main className="sheet">{children}</main>
    </div>
  );
}

export function RepoNav({
  owner,
  name,
  current,
}: {
  owner: string;
  name: string;
  current: string;
}) {
  const links = [
    ["Code", `/${owner}/${name}`],
    ["Commits", `/${owner}/${name}/commits/main`],
    ["Branches", `/${owner}/${name}/branches`],
    ["Tags", `/${owner}/${name}/tags`],
    ["Pulls", `/${owner}/${name}/pulls`],
    ["Settings", `/${owner}/${name}/settings`],
  ];
  return (
    <nav className="repo-nav">
      {links.map(([label, href]) => (
        <a aria-current={label === current ? "page" : undefined} href={href} key={label}>
          {label}
        </a>
      ))}
    </nav>
  );
}

export function Patch({ patch }: { patch: string }) {
  if (!patch) return <p className="pad muted">No diff.</p>;
  return (
    <pre className="patch">
      {patch.split("\n").map((line, index) => {
        const kind = line.startsWith("+")
          ? "add"
          : line.startsWith("-")
            ? "del"
            : line.startsWith("diff ") || line.startsWith("@@")
              ? "meta"
              : "ctx";
        return (
          <div className={kind} key={`${index}-${line.slice(0, 12)}`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}
