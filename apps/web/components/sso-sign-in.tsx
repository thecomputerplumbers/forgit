"use client";

import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { safeNext } from "./auth-forms";

export function SSOSignIn({ next }: { next?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signIn(formData: FormData) {
    setError(null);
    setPending(true);
    const organizationSlug = String(formData.get("organizationSlug") ?? "")
      .trim()
      .toLowerCase();
    const result = await authClient.signIn.sso({
      organizationSlug,
      callbackURL: safeNext(next),
    });
    if (result.error) {
      setError(result.error.message ?? "Could not start SSO sign-in");
      setPending(false);
    }
  }

  return (
    <form action={signIn} className="form">
      <label className="field">
        <span className="field-label">Organization slug</span>
        <input
          name="organizationSlug"
          required
          autoComplete="organization"
          placeholder="your-organization"
        />
      </label>
      {error ? (
        <p className="alert alert-danger" role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn btn-primary btn-block" disabled={pending} type="submit">
        {pending ? "Redirecting…" : "Continue with SSO"}
      </button>
    </form>
  );
}
