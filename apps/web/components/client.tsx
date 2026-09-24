"use client";

import { useEffect, useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { hue, initials } from "@/lib/format";
import { animalFor } from "@/lib/themes";

import { ThemePicker } from "./theme";

import { Icon } from "./icons";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      aria-label={copied ? "Copied" : label}
      className="btn btn-icon btn-ghost"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
      }}
      title={copied ? "Copied" : label}
      type="button"
    >
      <Icon name={copied ? "check" : "copy"} />
    </button>
  );
}

export function CopyField({ value, label }: { value: string; label?: string }) {
  return (
    <div className="copy-field">
      <input
        aria-label={label ?? "Value"}
        onFocus={(event) => event.currentTarget.select()}
        readOnly
        spellCheck={false}
        value={value}
      />
      <CopyButton label={label ? `Copy ${label.toLowerCase()}` : "Copy"} value={value} />
    </div>
  );
}

export function CodeBlock({ code }: { code: string }) {
  return (
    <div className="code-block">
      <pre>{code}</pre>
      <CopyButton label="Copy commands" value={code} />
    </div>
  );
}

export function UserMenu({ login, name }: { login: string; name: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function close(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;
    }
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return (
    <details className="menu" ref={ref}>
      <summary aria-label="Account menu" className="menu-trigger">
        <span
          className="avatar"
          style={{ width: 28, height: 28, fontSize: 11, ["--avatar-hue" as string]: hue(login) }}
        >
          <span className="avatar-initials">{initials(login)}</span>
          <span className="avatar-animal">{animalFor(login)}</span>
        </span>
        <Icon name="chevronDown" size={14} />
      </summary>
      <div className="menu-panel" role="menu">
        <div className="menu-heading">
          <strong>{name}</strong>
          <span>@{login}</span>
        </div>
        <ThemePicker />
        <hr />
        <a className="menu-item" href="/settings/tokens" role="menuitem">
          <Icon name="key" /> Access tokens
        </a>
        <a className="menu-item" href="/settings/members" role="menuitem">
          <Icon name="users" /> Members
        </a>
        <a className="menu-item" href="/settings/billing" role="menuitem">
          <Icon name="building" /> Billing
        </a>
        <a className="menu-item" href="/settings/sso" role="menuitem">
          <Icon name="key" /> Organization SSO
        </a>
        <hr />
        <button
          className="menu-item"
          onClick={async () => {
            await authClient.signOut();
            window.location.href = "/sign-in";
          }}
          role="menuitem"
          type="button"
        >
          <Icon name="logOut" /> Sign out
        </button>
      </div>
    </details>
  );
}

/**
 * Filters server-rendered items in place. Each item inside `target` carries a
 * `data-filter` attribute with the text it should match.
 */
export function ListFilter({
  target,
  placeholder,
  autoFocus,
}: {
  target: string;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [empty, setEmpty] = useState(false);
  function apply(value: string) {
    setQuery(value);
    const root = document.getElementById(target);
    if (!root) return;
    const needle = value.trim().toLowerCase();
    let shown = 0;
    for (const item of root.querySelectorAll<HTMLElement>("[data-filter]")) {
      const match = !needle || (item.dataset.filter ?? "").toLowerCase().includes(needle);
      item.hidden = !match;
      if (match) shown += 1;
    }
    setEmpty(shown === 0 && Boolean(needle));
  }
  return (
    <div className="filter">
      <label className="filter-input">
        <Icon name="search" />
        <input
          aria-label={placeholder}
          autoFocus={autoFocus}
          onChange={(event) => apply(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") apply("");
          }}
          placeholder={placeholder}
          type="search"
          value={query}
        />
      </label>
      {empty ? (
        <p className="filter-empty" role="status">
          Nothing matches “{query.trim()}”.
        </p>
      ) : null}
    </div>
  );
}
