import Link from "next/link";

import { SignInForm } from "@/components/auth-forms";
import { Shell } from "@/components/shell";

export default function SignUpPage() {
  return (
    <Shell host="forgit">
      <div className="sheet-head">
        <h1>Create an account</h1>
        <p className="muted">
          Already have one? <Link href="/sign-in">Sign in</Link>
        </p>
      </div>
      <SignInForm mode="sign-up" />
    </Shell>
  );
}
