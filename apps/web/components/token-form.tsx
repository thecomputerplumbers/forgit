"use client";

import { useState } from "react";

import type { Scope } from "@forgit/auth/scopes";

import { createTokenAction } from "@/app/actions";

import { CodeBlock, CopyField } from "./client";
import { Icon } from "./icons";

const GROUPS: Array<{ title: string; scopes: Array<[Scope, string]> }> = [
  {
    title: "Repositories",
    scopes: [
      ["repo:read", "Clone and read code"],
      ["repo:write", "Push branches and tags"],
      ["repo:admin", "Create, archive, and administer"],
    ],
  },
  {
    title: "Pull requests",
    scopes: [
      ["pull_request:read", "List and view"],
      ["pull_request:write", "Open, update, and merge"],
      ["review:write", "Approve and request changes"],
    ],
  },
  {
    title: "Automation",
    scopes: [
      ["checks:read", "Read check runs"],
      ["checks:write", "Report check runs from CI"],
      ["workflow:run", "Trigger workflows"],
      ["webhook:admin", "Manage webhooks"],
    ],
  },
  { title: "Account", scopes: [["user:read", "Read your profile"]] },
];

const PRESETS: Array<[string, Scope[]]> = [
  [
    "Developer",
    [
      "user:read",
      "repo:read",
      "repo:write",
      "pull_request:read",
      "pull_request:write",
      "review:write",
      "checks:read",
    ],
  ],
  ["Read only", ["user:read", "repo:read", "pull_request:read", "checks:read"]],
  ["CI", ["repo:read", "pull_request:read", "checks:read", "checks:write"]],
];

export function TokenForm({ host, repositories }: { host: string; repositories: string[] }) {
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [scopes, setScopes] = useState<Set<Scope>>(new Set(PRESETS[0]?.[1]));
  const [kind, setKind] = useState<"personal" | "machine">("personal");
  const [limit, setLimit] = useState(false);

  async function submit(formData: FormData) {
    setError(null);
    setPending(true);
    const result = await createTokenAction(formData);
    setPending(false);
    if ("error" in result) setError(result.error);
    else setPlaintext(result.plaintext);
  }

  if (plaintext) {
    return (
      <div className="secret">
        <div className="secret-title">
          <Icon name="checkCircle" /> Token created
        </div>
        <p>Copy it now. forgit stores only a hash, so you won't be able to see it again.</p>
        <CopyField label="Access token" value={plaintext} />
        <div className="stack" style={{ gap: 8 }}>
          <span className="field-label">Use it with Git</span>
          <CodeBlock
            code={`git -c http.extraHeader="Authorization: Bearer ${plaintext}" clone https://${host}/<owner>/<repo>.git`}
          />
          <span className="field-hint">Or paste it when Git asks for a password.</span>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <span className="field-label">
            Use it with <code>gh</code>
          </span>
          <CodeBlock
            code={`export GH_HOST=${host}\nexport GH_ENTERPRISE_TOKEN=${plaintext}\ngh config set git_protocol https --host ${host}\ngh auth status`}
          />
        </div>
        <div>
          <button className="btn" onClick={() => window.location.reload()} type="button">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={submit} className="form">
      <div className="form-row">
        <label className="field">
          <span className="field-label">Name</span>
          <input name="name" placeholder="e.g. laptop, deploy-bot" required />
          <span className="field-hint">So you can tell tokens apart later.</span>
        </label>
        <label className="field">
          <span className="field-label">Expiration</span>
          <select defaultValue="90" key={kind} name="days">
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
            {kind === "personal" ? <option value="0">No expiration</option> : null}
          </select>
          <span className="field-hint">
            {kind === "machine" ? "Machine tokens must expire." : "Revoke it any time."}
          </span>
        </label>
      </div>

      <fieldset>
        <legend>Type</legend>
        <div className="choice-grid">
          <label className="choice">
            <input
              checked={kind === "personal"}
              name="kind"
              onChange={() => setKind("personal")}
              type="radio"
              value="personal"
            />
            <div>
              <strong>
                <Icon name="key" /> Personal
              </strong>
              <span>For your own Git, gh, and API use.</span>
            </div>
          </label>
          <label className="choice">
            <input
              checked={kind === "machine"}
              name="kind"
              onChange={() => setKind("machine")}
              type="radio"
              value="machine"
            />
            <div>
              <strong>
                <Icon name="terminal" /> Machine
              </strong>
              <span>Short-lived, for CI jobs and automation.</span>
            </div>
          </label>
        </div>
      </fieldset>

      <fieldset>
        <div className="row" style={{ marginBottom: 10 }}>
          <legend style={{ margin: 0, float: "left" }}>Scopes</legend>
          <span className="spacer" />
          <span className="field-hint">Presets:</span>
          {PRESETS.map(([label, preset]) => (
            <button
              className="btn btn-sm btn-ghost"
              key={label}
              onClick={() => setScopes(new Set(preset))}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="stack" style={{ gap: 14 }}>
          {GROUPS.map((group) => (
            <div key={group.title}>
              <div className="field-hint" style={{ fontWeight: 600, marginBottom: 6 }}>
                {group.title}
              </div>
              <div className="check-grid">
                {group.scopes.map(([scope, description]) => (
                  <label className="check" key={scope} title={description}>
                    <input
                      checked={scopes.has(scope)}
                      name="scopes"
                      onChange={(event) => {
                        const next = new Set(scopes);
                        if (event.target.checked) next.add(scope);
                        else next.delete(scope);
                        setScopes(next);
                      }}
                      type="checkbox"
                      value={scope}
                    />
                    <span>
                      <code>{scope}</code>
                      <br />
                      <span className="muted" style={{ fontSize: 12 }}>
                        {description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="field-hint" style={{ marginTop: 10 }}>
          A token never grants more than your own role on a repository.
        </p>
      </fieldset>

      <fieldset>
        <legend>Repository access</legend>
        <div className="stack" style={{ gap: 10 }}>
          <label className="check">
            <input checked={!limit} onChange={() => setLimit(false)} type="radio" />
            All repositories you can access
          </label>
          <label className="check">
            <input
              checked={limit}
              disabled={repositories.length === 0}
              onChange={() => setLimit(true)}
              type="radio"
            />
            Only selected repositories
          </label>
          {limit ? (
            <div className="check-grid" style={{ paddingLeft: 24 }}>
              {repositories.map((repo) => (
                <label className="check" key={repo}>
                  <input name="repositories" type="checkbox" value={repo} />
                  <code>{repo}</code>
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </fieldset>

      {error ? (
        <div className="alert alert-danger" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      ) : null}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={pending || scopes.size === 0} type="submit">
          {pending ? "Generating…" : "Generate token"}
        </button>
      </div>
    </form>
  );
}
