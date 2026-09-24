import { InviteForm } from "@/components/auth-forms";
import { Shell } from "@/components/shell";
import { Avatar, Badge, Box, PageHeader } from "@/components/ui";
import { requireOrganization } from "@/lib/session";
import { d1Sql } from "@forgit/db/sql-store";
import { env } from "cloudflare:workers";
import { listPendingInvitations } from "@/lib/invitation-grants";
import { CopyField } from "@/components/client";

export const metadata = { title: "Members" };

export default async function MembersPage() {
  const { services, user, organization } = await requireOrganization();
  const members = await services.store.listOrgMembers(organization.id);
  const origin = new URL(services.cloneUrl(organization.slug, "x")).origin;
  const me = members.find((member) => member.userId === user.id);
  const canInvite = me?.role === "owner" || me?.role === "admin";
  const [repositories, invitations] = canInvite
    ? await Promise.all([
        services.store.listRepositoriesForOrg(organization.id),
        listPendingInvitations(d1Sql(env.DB), organization.id, services.store.now()),
      ])
    : [[], []];
  return (
    <Shell organization={organization} user={user}>
      <div className="container container-narrow page">
        <PageHeader
          description="Owners and admins can administer every repository. Members need a role on each repository they work in."
          title={`${organization.name} members`}
        />
        <div className="stack" style={{ gap: 24 }}>
          <Box flush title={`${members.length} ${members.length === 1 ? "member" : "members"}`}>
            <ul className="list">
              {members.map((member) => (
                <li key={member.userId}>
                  <Avatar name={member.name || member.login} size={32} />
                  <div className="list-main">
                    <div className="list-title">
                      {member.name || member.login}
                      {member.userId === user.id ? <Badge>You</Badge> : null}
                    </div>
                    <div className="list-meta">
                      @{member.login}
                      <span className="dot" />
                      {member.email}
                    </div>
                  </div>
                  <Badge tone={member.role === "member" ? "neutral" : "accent"}>
                    {member.role[0]?.toUpperCase()}
                    {member.role.slice(1)}
                  </Badge>
                </li>
              ))}
            </ul>
          </Box>
          {canInvite ? (
            <Box
              description="Choose repository access now. It takes effect when they accept."
              title="Invite someone"
            >
              <InviteForm
                origin={origin}
                repositories={repositories
                  .filter((repository) => !repository.archived)
                  .map((repository) => ({ id: repository.id, name: repository.name }))}
              />
            </Box>
          ) : null}
          {canInvite && invitations.length ? (
            <Box title="Pending invitations">
              <ul className="list">
                {invitations.map((invitation) => (
                  <li key={invitation.id}>
                    <div className="list-main">
                      <div className="list-title">{invitation.email}</div>
                      <div className="list-meta">
                        {invitation.repositoryName
                          ? `${invitation.repositoryName} · ${invitation.repositoryRole} access`
                          : "Organization only"}
                      </div>
                      <CopyField
                        label="Invitation link"
                        value={`${origin}/invitations/${invitation.id}`}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Box>
          ) : null}
        </div>
      </div>
    </Shell>
  );
}
