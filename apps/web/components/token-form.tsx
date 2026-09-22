"use client";

import { useState } from "react";

import { createTokenAction } from "@/app/actions";

export function TokenForm() {
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(formData: FormData) {
    setError(null);
    const result = await createTokenAction(formData);
    if ("error" in result) setError(result.error);
    else setPlaintext(result.plaintext);
  }
  return (
    <>
      {plaintext ? (
        <p className="token">
          Copy this token now. forgit stores only its hash.
          <br />
          {plaintext}
        </p>
      ) : null}
      <form action={submit} className="stack">
        <label>
          Name
          <input name="name" required placeholder="laptop" />
        </label>
        <label>
          Scopes
          <input
            name="scopes"
            defaultValue="repo:read repo:write pull_request:read pull_request:write review:write checks:read"
          />
        </label>
        <label>
          Kind
          <select name="kind">
            <option value="personal">Personal access token</option>
            <option value="machine">Short-lived machine token</option>
          </select>
        </label>
        <label>
          Limit to repositories
          <input name="repositories" placeholder="acme/widget" />
        </label>
        <label>
          Expires in days (0 keeps a personal token until you revoke it)
          <input name="days" type="number" min="0" defaultValue="90" />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit">Create token</button>
      </form>
    </>
  );
}
