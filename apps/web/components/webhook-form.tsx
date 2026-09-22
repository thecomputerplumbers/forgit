"use client";

import { useState } from "react";

import { createWebhookAction } from "@/app/actions";

export function WebhookForm({ owner, repo }: { owner: string; repo: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(formData: FormData) {
    setError(null);
    const result = await createWebhookAction(formData);
    if ("error" in result) setError(result.error);
    else setSecret(result.secret);
  }
  return (
    <>
      {secret ? (
        <p className="token">
          Copy this webhook secret now. Deliveries are signed with it.
          <br />
          {secret}
        </p>
      ) : null}
      <form action={submit} className="stack">
        <input type="hidden" name="owner" value={owner} />
        <input type="hidden" name="repo" value={repo} />
        <label>
          HTTPS endpoint
          <input name="url" type="url" required placeholder="https://example.com/hooks/forgit" />
        </label>
        <label>
          Events
          <input name="events" defaultValue="*" />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit">Create webhook</button>
      </form>
    </>
  );
}
