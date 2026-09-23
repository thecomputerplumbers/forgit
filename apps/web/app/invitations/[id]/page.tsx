import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AcceptInvitation } from "@/components/auth-forms";
import { AuthShell } from "@/components/shell";
import { auth } from "@/lib/auth";

export const metadata = { title: "Join organization" };

export default async function InvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/invitations/${id}`)}`);
  return (
    <AuthShell>
      <div className="auth-card">
        <h1>You're invited</h1>
        <p>
          Signed in as <strong>{session.user.email}</strong>. Accept to join the organization on
          this forgit instance.
        </p>
        <AcceptInvitation id={id} />
      </div>
    </AuthShell>
  );
}
