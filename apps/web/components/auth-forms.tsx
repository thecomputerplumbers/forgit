"use client";

import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { useState } from "react";

const authClient = createAuthClient({ plugins: [organizationClient()] });

export function SignInForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const [error, setError] = useState<string | null>(null);
  async function submit(formData: FormData) {
    setError(null);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const result =
      mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({
            email,
            password,
            name: String(formData.get("name") ?? email),
          });
    if (result.error) {
      setError(result.error.message ?? "Authentication failed");
      return;
    }
    window.location.href = "/";
  }
  return (
    <form action={submit} className="stack">
      {mode === "sign-up" ? (
        <label>
          Name
          <input name="name" required autoComplete="name" />
        </label>
      ) : null}
      <label>
        Email
        <input name="email" type="email" required autoComplete="email" />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
        />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button type="submit">{mode === "sign-in" ? "Sign in" : "Create account"}</button>
    </form>
  );
}

export function CreateOrganizationForm() {
  const [error, setError] = useState<string | null>(null);
  async function submit(formData: FormData) {
    setError(null);
    const name = String(formData.get("name") ?? "");
    const slug = String(formData.get("slug") ?? "");
    const result = await authClient.organization.create({ name, slug });
    if (result.error) {
      setError(result.error.message ?? "Could not create the organization");
      return;
    }
    if (result.data) await authClient.organization.setActive({ organizationId: result.data.id });
    window.location.href = "/";
  }
  return (
    <form action={submit} className="stack">
      <label>
        Organization name
        <input name="name" required />
      </label>
      <label>
        Slug
        <input name="slug" required pattern="[a-z0-9][a-z0-9-]{0,38}" />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button type="submit">Create organization</button>
    </form>
  );
}

export function InviteForm() {
  const [message, setMessage] = useState<string | null>(null);
  async function submit(formData: FormData) {
    setMessage(null);
    const email = String(formData.get("email") ?? "");
    const result = await authClient.organization.inviteMember({ email, role: "member" });
    if (result.error) {
      setMessage(result.error.message ?? "Invite failed");
      return;
    }
    const id = result.data?.id;
    setMessage(
      id
        ? `Invitation ${id}. They can open /invitations/${id} after signing in.`
        : "Invitation sent.",
    );
  }
  return (
    <form action={submit} className="stack">
      <label>
        Email
        <input name="email" type="email" required />
      </label>
      {message ? <p>{message}</p> : null}
      <button type="submit">Invite member</button>
    </form>
  );
}
