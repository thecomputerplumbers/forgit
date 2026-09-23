import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { CreateOrganizationForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/shell";
import { requireForge } from "@/lib/session";

export const metadata = { title: "Create your organization" };

export default async function OnboardingPage() {
  const { organization } = await requireForge();
  if (organization) redirect("/");
  const host = (await headers()).get("host") ?? "forgit";
  return (
    <AuthShell>
      <div className="auth-card">
        <h1>Create your organization</h1>
        <p>This instance hosts one organization. Its slug is the owner in every repository URL.</p>
        <CreateOrganizationForm host={host} />
      </div>
    </AuthShell>
  );
}
