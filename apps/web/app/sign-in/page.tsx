import { env } from "cloudflare:workers";

import { SignInForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/shell";

export const metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const query = next ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <AuthShell>
      <div className="auth-card">
        <h1>Sign in to forgit</h1>
        <p>Welcome back. Enter your details to continue.</p>
        <SignInForm
          googleEnabled={Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)}
          mode="sign-in"
          next={next}
        />
      </div>
      <p className="auth-switch">
        New here? <a href={`/sign-up${query}`}>Create an account</a>
      </p>
      <p className="auth-switch">
        <a href={`/sign-in/sso${query}`}>Sign in with organization SSO</a>
      </p>
    </AuthShell>
  );
}
