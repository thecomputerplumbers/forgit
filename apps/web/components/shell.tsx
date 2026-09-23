import type { ReactNode } from "react";

import { UserMenu } from "./client";
import { Icon } from "./icons";

export function Logo() {
  return (
    <a aria-label="forgit home" className="logo" href="/">
      <span className="logo-mark" aria-hidden="true">
        {/* The Melt swaps the branch mark for an eye that follows the pointer. */}
        <svg className="logo-eye" height="18" viewBox="0 0 24 24" width="18">
          <ellipse className="logo-eye-white" cx="12" cy="12" rx="10.5" ry="7.5" />
          <g className="logo-eye-pupil">
            <circle cx="12" cy="12" fill="#1a0b2e" r="4.2" />
            <circle cx="13.4" cy="10.6" fill="#fff" r="1.2" />
          </g>
        </svg>
        <svg className="logo-branch" fill="none" height="16" viewBox="0 0 24 24" width="16">
          <path
            d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a9 9 0 0 1-9 9"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.25"
          />
        </svg>
      </span>
      <span className="logo-word">forgit</span>
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
          <Logo />
        </div>
        {children}
        <p className="auth-foot">Self-hosted Git on Cloudflare</p>
      </div>
    </div>
  );
}
