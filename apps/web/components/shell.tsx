import type { ReactNode } from "react";

import { Lockup, TAGLINE } from "./brand";
import { UserMenu } from "./client";
import { Icon } from "./icons";

export function Logo() {
  return (
    <a aria-label="forgit home" className="logo" href="/">
      <Lockup />
      {/* The Melt adds an eye that follows the pointer; other themes hide it. */}
      <svg aria-hidden="true" className="logo-eye" height="18" viewBox="0 0 24 24" width="18">
        <ellipse className="logo-eye-white" cx="12" cy="12" rx="10.5" ry="7.5" />
        <g className="logo-eye-pupil">
          <circle cx="12" cy="12" fill="#1a0b2e" r="4.2" />
          <circle cx="13.4" cy="10.6" fill="#fff" r="1.2" />
        </g>
      </svg>
    </a>
  );
}

export function Shell({
  user,
  organization,
  children,
}: {
  user: { login: string; name: string };
  organization?: { name: string; slug: string } | null;
  children: ReactNode;
}) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <Logo />
          {organization ? (
            <>
              <span className="topbar-sep" aria-hidden="true">
                /
              </span>
              <a className="topbar-org" href="/">
                <Icon name="building" size={14} />
                {organization.name}
              </a>
            </>
          ) : null}
          <nav className="topbar-nav" aria-label="Main">
            <a
              aria-label="New repository"
              className="btn btn-icon btn-ghost"
              href="/new"
              title="New repository"
            >
              <Icon name="plus" />
            </a>
            <UserMenu login={user.login} name={user.name} />
          </nav>
        </div>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}

/** The centered card used before a person has a session or an organization. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-inner">
        <div className="auth-logo">
          <a aria-label="forgit home" href="/">
            <Lockup size={40} />
          </a>
          <p className="auth-tagline">{TAGLINE}</p>
        </div>
        {children}
        <p className="auth-foot">Self-hosted Git on Cloudflare</p>
      </div>
    </div>
  );
}
