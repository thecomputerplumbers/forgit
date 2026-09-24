"use client";

import { useState } from "react";

import { authClient } from "@/lib/auth-client";

import { CopyField } from "./client";

const issuer = "https://auth.thecomputerplumbers.com/api/auth";

type Connection = {
  providerId: string;
  domain: string;
  domainVerified?: boolean;
  oidcConfig?: { clientIdLastFour?: string; pkce?: boolean };
};

export function SSOSettings({
  organizationId,
  origin,
  initialConnection,
}: {
  organizationId: string;
  origin: string;
  initialConnection: Connection | null;
}) {
  const providerId = `tcp-${organizationId}`;
  const callback = `${origin}/api/auth/sso/callback/${providerId}`;
  const [connection, setConnection] = useState(initialConnection);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(formData: FormData) {
    setPending(true);
    setError(null);
    setNotice(null);
    const domain = String(formData.get("domain") ?? "")
      .trim()
      .toLowerCase();
    const clientId = String(formData.get("clientId") ?? "").trim();
    const clientSecret = String(formData.get("clientSecret") ?? "").trim();
    const result = connection
      ? await authClient.sso.updateProvider({
          providerId,
          domain,
          oidcConfig: { clientId, clientSecret, pkce: true },
        })
      : await authClient.sso.register({
          providerId,
          organizationId,
          issuer,
          domain,
          oidcConfig: {
            clientId,
            clientSecret,
            pkce: true,
            scopes: ["openid", "email", "profile"],
          },
        });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Could not save SSO connection");
      return;
    }
    setConnection({
      providerId,
      domain,
      domainVerified: result.data?.domainVerified ?? false,
      oidcConfig: result.data?.oidcConfig ?? { pkce: true },
    });
    setVerificationToken(null);
    setNotice(
      result.data?.domainVerified
        ? "SSO connection updated. Members can sign in with SSO."
        : "SSO connection saved. Verify the email domain to enable sign-in.",
    );
  }

  async function getVerificationToken() {
    setPending(true);
    setError(null);
    const result = await authClient.sso.requestDomainVerification({ providerId });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Could not request domain verification");
      return;
    }
    setVerificationToken(result.data?.domainVerificationToken ?? null);
  }

  async function verifyDomain() {
    setPending(true);
    setError(null);
    const result = await authClient.sso.verifyDomain({ providerId });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Domain verification failed");
      return;
    }
    setConnection((current) => (current ? { ...current, domainVerified: true } : current));
    setNotice("Domain verified. Members can now sign in with SSO.");
  }

  async function remove() {
    if (!connection || !window.confirm("Remove this organization's SSO connection?")) return;
    setPending(true);
    setError(null);
    const result = await authClient.sso.deleteProvider({ providerId });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Could not remove SSO connection");
      return;
    }
    setConnection(null);
    setVerificationToken(null);
    setNotice("SSO connection removed.");
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <p>
        Connect this organization to The Computer Plumbers sign-in. Members can then enter the
        organization slug on the Forgit sign-in page. New SSO users join as members.
      </p>
      <div className="stack">
        <div className="field-label">Issuer</div>
        <CopyField label="OIDC issuer" value={issuer} />
        <div className="field-label">Redirect URI</div>
        <CopyField label="Redirect URI" value={callback} />
        <p className="field-hint">
          Register a confidential OAuth client with this redirect URI in{" "}
          <a href="https://auth.thecomputerplumbers.com/oauth/clients">
            The Computer Plumbers auth service
          </a>
          . Require PKCE and allow the openid, email, and profile scopes.
        </p>
      </div>
      {connection ? (
        <p>
          Connected for <strong>{connection.domain}</strong>
          {connection.oidcConfig?.clientIdLastFour
            ? ` · Client ending ${connection.oidcConfig.clientIdLastFour}`
            : ""}
          . {connection.domainVerified ? "Domain verified." : "Domain verification required."} Enter
          the client credentials again to update the connection.
        </p>
      ) : null}
      <form action={save} className="form">
        <label className="field">
          <span className="field-label">Email domain</span>
          <input
            name="domain"
            type="text"
            required
            defaultValue={connection?.domain ?? "thecomputerplumbers.com"}
            placeholder="thecomputerplumbers.com"
            pattern="[a-zA-Z0-9.-]+"
          />
          <span className="field-hint">
            The domain of email addresses at the identity provider.
          </span>
        </label>
        <label className="field">
          <span className="field-label">OAuth client ID</span>
          <input name="clientId" required autoComplete="off" />
        </label>
        <label className="field">
          <span className="field-label">OAuth client secret</span>
          <input name="clientSecret" type="password" required autoComplete="off" />
        </label>
        {error ? (
          <p className="alert alert-danger" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="alert" role="status">
            {notice}
          </p>
        ) : null}
        <button className="btn btn-primary" disabled={pending} type="submit">
          {pending ? "Saving…" : connection ? "Update SSO" : "Enable SSO"}
        </button>
      </form>
      {connection && !connection.domainVerified ? (
        <div className="stack">
          <p>
            Prove ownership of {connection.domain} with a DNS TXT record before anyone can use SSO.
          </p>
          <button className="btn" disabled={pending} onClick={getVerificationToken} type="button">
            Get verification token
          </button>
          {verificationToken ? (
            <>
              <div className="field-label">TXT record name</div>
              <CopyField
                label="TXT record name"
                value={`_better-auth-token-${providerId}.${connection.domain}`}
              />
              <div className="field-label">TXT record value</div>
              <CopyField label="TXT record value" value={verificationToken} />
              <button
                className="btn btn-primary"
                disabled={pending}
                onClick={verifyDomain}
                type="button"
              >
                Verify domain
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {connection ? (
        <button className="btn" disabled={pending} onClick={remove} type="button">
          Remove SSO connection
        </button>
      ) : null}
    </div>
  );
}
