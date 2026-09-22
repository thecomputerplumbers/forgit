import { headers } from "next/headers";

import { InviteForm } from "@/components/auth-forms";
import { Shell } from "@/components/shell";
import { requireOrganization } from "@/lib/session";

export default async function MembersPage() {
  const { services, user, organization } = await requireOrganization();
  const members = await services.store.listOrgMembers(organization.id);
  const host = (await headers()).get("host") ?? "forgit";
  return (
    <Shell host={host} login={user.login}>
      <div className="sheet-head">
        <h1>{organization.name} members</h1>
        <p className="muted">
          Organization owners and admins can administer every repository. Everyone else needs
          repository access.
        </p>
      </div>
      {members.map((member) => (
        <div className="row" key={member.userId}>
          <strong>{member.login}</strong>
          <span>{member.email}</span>
          <span className="sha">{member.role}</span>
        </div>
      ))}
      <InviteForm />
    </Shell>
  );
}
