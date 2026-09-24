import { env } from "cloudflare:workers";

import { SignInForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/shell";
import { signUpDisabled } from "@/lib/sign-up-policy";

export const metadata = { title: "Create an account" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const query = next ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <AuthShell>
      <div className="auth-card">
        {signUpDisabled(env.DISABLE_SIGN_UP) ? (
          <>
            <h1>Signups are closed</h1>
            <p>
              {env.HOSTED_MODE === "true"
                ? "Forgit Cloud is in private preview. Request access from the homepage."
                : "Ask your organization owner for access to this forgit instance."}
            </p>
          </>
        ) : (
          <>
            <h1>Create your account</h1>
            <p>Host your repositories on your own Cloudflare account.</p>
            <SignInForm mode="sign-up" next={next} />
          </>
        )}
      </div>
      <p className="auth-switch">
        Already have an account? <a href={`/sign-in${query}`}>Sign in</a>
      </p>
    </AuthShell>
  );
}
