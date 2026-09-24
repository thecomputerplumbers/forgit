import { AuthShell } from "@/components/shell";
import { SSOSignIn } from "@/components/sso-sign-in";

export const metadata = { title: "Organization SSO" };

export default async function SSOSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <AuthShell>
      <div className="auth-card">
        <h1>Sign in with SSO</h1>
        <p>Enter your Forgit organization slug to continue to The Computer Plumbers.</p>
        <SSOSignIn next={next} />
      </div>
      <p className="auth-switch">
        <a href="/sign-in">Use a password</a>
      </p>
    </AuthShell>
  );
}
