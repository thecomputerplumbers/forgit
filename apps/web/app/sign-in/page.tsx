import Link from "next/link";

import { SignInForm } from "@/components/auth-forms";
import { Shell } from "@/components/shell";

export default function SignInPage() {
  return (
    <Shell host="forgit">
      <div className="sheet-head">
        <h1>Sign in</h1>
        <p className="muted">
          New here? <Link href="/sign-up">Create an account</Link>
        </p>
      </div>
      <SignInForm mode="sign-in" />
    </Shell>
  );
}
