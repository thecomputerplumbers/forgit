"use client";

import { useState } from "react";

import { createWebhookAction } from "@/app/actions";

import { CopyField } from "./client";
import { Icon } from "./icons";

export function WebhookForm({ owner, repo }: { owner: string; repo: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(formData: FormData) {
    setError(null);
    setPending(true);
    const result = await createWebhookAction(formData);
    setPending(false);
    if ("error" in result) setError(result.error);
    else setSecret(result.secret);
  }
  return (
    <div className="stack">
      {secret ? (
        <div className="secret">
          <div className="secret-title">
            <Icon name="checkCircle" /> Webhook created
          </div>
          <p>
            Copy the signing secret now. You won't see it again. Verify each delivery's{" "}
            <code>X-Forgit-Signature</code> header with it.
          </p>
          <CopyField label="Webhook secret" value={secret} />
          <div>
            <button className="btn btn-sm" onClick={() => window.location.reload()} type="button">
              Done
            </button>
          </div>
        </div>
      ) : null}
      <form action={submit} className="form">
        <input name="owner" type="hidden" value={owner} />
        <input name="repo" type="hidden" value={repo} />
        <div className="form-row">
          <label className="field" style={{ gridColumn: "span 2" }}>
            <span className="field-label">Payload URL</span>
            <input name="url" placeholder="https://example.com/hooks/forgit" required type="url" />
          </label>
          <label className="field">
            <span className="field-label">Events</span>
            <input defaultValue="*" name="events" spellCheck={false} />
            <span className="field-hint">
              <code>*</code> for all, or a list like <code>push pull_request</code>.
            </span>
          </label>
        </div>
        {error ? (
          <div className="alert alert-danger" role="alert">
            <Icon name="alert" />
            <div>{error}</div>
          </div>
        ) : null}
        <div className="form-actions">
          <button className="btn" disabled={pending} type="submit">
            <Icon name="plus" /> {pending ? "Adding…" : "Add webhook"}
          </button>
        </div>
      </form>
    </div>
  );
}
