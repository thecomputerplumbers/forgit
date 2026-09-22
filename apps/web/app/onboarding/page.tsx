import { headers } from "next/headers";

import { CreateOrganizationForm } from "@/components/auth-forms";
import { Shell } from "@/components/shell";
import { requireForge } from "@/lib/session";

export default async function OnboardingPage() {
  const { user, organization } = await requireForge();
  if (organization) {
    const { redirect } = await import("next/navigation");
    redirect("/");
  }
  const host = (await headers()).get("host") ?? "forgit";
  return (
    <Shell host={host} login={user.login}>
      <div className="sheet-head">
        <h1>Name the organization</h1>
        <p className="muted">
          A forgit instance is single-tenant. This slug is the owner in clone URLs.
        </p>
      </div>
      <CreateOrganizationForm />
    </Shell>
  );
}
