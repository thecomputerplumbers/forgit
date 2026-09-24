import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Shell } from "@/components/shell";
import { SSOSettings } from "@/components/sso-settings";
import { Box, PageHeader } from "@/components/ui";
import { auth } from "@/lib/auth";
import { requireOrganization } from "@/lib/session";

export const metadata = { title: "Organization SSO" };

export default async function OrganizationSSOPage() {
  const { services, user, organization } = await requireOrganization();
  const members = await services.store.listOrgMembers(organization.id);
  const me = members.find((member) => member.userId === user.id);
  if (me?.role !== "owner" && me?.role !== "admin") redirect("/settings/members");
  const result = await auth.api.listSSOProviders({ headers: await headers() });
  const connection = result.providers.find(
    (provider) =>
      provider.providerId === `tcp-${organization.id}` &&
      provider.organizationId === organization.id,
  );
  const origin = new URL(services.cloneUrl(organization.slug, "x")).origin;

  return (
    <Shell organization={organization} user={user}>
      <div className="container container-narrow page">
        <PageHeader
          title={`${organization.name} SSO`}
          description="Configure sign-in through The Computer Plumbers for this organization."
        />
        <Box title="OpenID Connect">
          <SSOSettings
            organizationId={organization.id}
            origin={origin}
            initialConnection={connection ?? null}
          />
        </Box>
      </div>
    </Shell>
  );
}
