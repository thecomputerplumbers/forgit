"use client";

import { useState } from "react";

import { authClient } from "@/lib/auth-client";

import { CopyField } from "./client";
import { Icon } from "./icons";

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="alert alert-danger" role="alert">
      <Icon name="alert" />
      <div>{message}</div>
    </div>
  );
}

/** Only same-origin paths, so a crafted link cannot bounce a new session elsewhere. */
export function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function SignInForm({
  mode,
  next,
  googleEnabled = false,
}: {
  mode: "sign-in" | "sign-up";
  next?: string;
  googleEnabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(formData: FormData) {
    setError(null);
    setPending(true);
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
      setPending(false);
      return;
    }
    window.location.href = safeNext(next);
  }
  async function signInWithGoogle() {
    setError(null);
    setPending(true);
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: safeNext(next),
      });
      if (result.error) {
        setError(result.error.message ?? "Could not start Google sign-in");
        setPending(false);
      }
    } catch {
      setError("Could not start Google sign-in");
      setPending(false);
    }
  }
  return (
    <div className="form">
      {mode === "sign-in" && googleEnabled ? (
        <>
          <button
            aria-label="Sign in with Google"
            className="google-sign-in"
            disabled={pending}
            onClick={signInWithGoogle}
            type="button"
          >
            <img alt="" height={40} src="/brand/google-signin.svg" width={180} />
          </button>
          <div className="auth-divider">or sign in with email</div>
        </>
      ) : null}
      <form action={submit} className="form">
        {mode === "sign-up" ? (
          <label className="field">
            <span className="field-label">Full name</span>
            <input name="name" required autoComplete="name" placeholder="Ada Lovelace" />
          </label>
        ) : null}
        <label className="field">
          <span className="field-label">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
          />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          />
          {mode === "sign-up" ? <span className="field-hint">At least 8 characters.</span> : null}
        </label>
        <FormError message={error} />
        <button className="btn btn-primary btn-block" disabled={pending} type="submit">
          {pending ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
      </form>
    </div>
  );
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 39);
}

export function CreateOrganizationForm({ host }: { host: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const shownSlug = slugEdited ? slug : toSlug(name);
  async function submit(formData: FormData) {
    setError(null);
    setPending(true);
    const result = await authClient.organization.create({
      name: String(formData.get("name") ?? ""),
      slug: String(formData.get("slug") ?? ""),
    });
    if (result.error) {
      setError(result.error.message ?? "Could not create the organization");
      setPending(false);
      return;
    }
    if (result.data) await authClient.organization.setActive({ organizationId: result.data.id });
    window.location.href = "/";
  }
  return (
    <form action={submit} className="form">
      <label className="field">
        <span className="field-label">Organization name</span>
        <input
          name="name"
          onChange={(event) => setName(event.target.value)}
          placeholder="Acme Inc."
          required
          value={name}
        />
      </label>
      <label className="field">
        <span className="field-label">URL slug</span>
        <input
          name="slug"
          onChange={(event) => {
            setSlugEdited(true);
            setSlug(event.target.value);
          }}
          pattern="[a-z0-9][a-z0-9\-]{0,38}"
          placeholder="acme"
          required
          value={shownSlug}
        />
        <span className="field-hint">
          Lowercase letters, numbers, and dashes. Clone URLs look like{" "}
          <code>
            {host}/{shownSlug || "acme"}/repo.git
          </code>
        </span>
      </label>
      <FormError message={error} />
      <button className="btn btn-primary btn-block" disabled={pending} type="submit">
        {pending ? "Creating…" : "Create organization"}
      </button>
    </form>
  );
}

export function InviteForm({ origin }: { origin: string }) {
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(formData: FormData) {
    setError(null);
    setLink(null);
    setPending(true);
    const email = String(formData.get("email") ?? "");
    const result = await authClient.organization.inviteMember({ email, role: "member" });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Invite failed");
      return;
    }
    const id = result.data?.id;
    setLink(id ? `${origin}/invitations/${id}` : "");
  }
  return (
    <div className="stack">
      <form action={submit} className="row">
        <input
          aria-label="Email address"
          name="email"
          placeholder="teammate@company.com"
          required
          style={{ flex: 1, minWidth: 220 }}
          type="email"
        />
        <button className="btn btn-primary" disabled={pending} type="submit">
          <Icon name="plus" /> {pending ? "Inviting…" : "Invite"}
        </button>
      </form>
      <FormError message={error} />
      {link !== null ? (
        <div className="secret">
          <div className="secret-title">
            <Icon name="checkCircle" /> Invitation created
          </div>
          {link ? (
            <>
              <p>Send this link. They open it after signing in to join the organization.</p>
              <CopyField label="Invitation link" value={link} />
            </>
          ) : (
            <p>The invitation was sent.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function AcceptInvitation({ id }: { id: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function accept() {
    setError(null);
    setPending(true);
    const result = await authClient.organization.acceptInvitation({ invitationId: id });
    if (result.error) {
      setError(result.error.message ?? "Could not accept the invitation");
      setPending(false);
      return;
    }
    const organizationId = result.data?.invitation.organizationId;
    if (organizationId) await authClient.organization.setActive({ organizationId });
    window.location.href = "/";
  }
  return (
    <div className="form">
      <FormError message={error} />
      <button
        className="btn btn-primary btn-block"
        disabled={pending}
        onClick={accept}
        type="button"
      >
        {pending ? "Joining…" : "Accept invitation"}
      </button>
    </div>
  );
}
