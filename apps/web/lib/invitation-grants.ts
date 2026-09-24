import type { Sql } from "@forgit/db/sql-store";

export type PendingInvitation = {
  id: string;
  email: string;
  expiresAt: number;
  repositoryName: string | null;
  repositoryRole: "read" | "write" | null;
};

export async function listPendingInvitations(
  sql: Sql,
  organizationId: string,
  now: number,
): Promise<PendingInvitation[]> {
  const rows = await sql.all<{
    id: string;
    email: string;
    expires_at: number;
    repository_name: string | null;
    repository_role: "read" | "write" | null;
  }>(
    `SELECT i.id, i.email, i.expires_at, r.name AS repository_name, g.role AS repository_role
     FROM invitation i
     LEFT JOIN invitation_repo_grants g ON g.invitation_id = i.id
     LEFT JOIN repositories r ON r.id = g.repository_id
     WHERE i.organization_id = ? AND i.status = 'pending' AND i.expires_at > ?
     ORDER BY i.created_at DESC`,
    [organizationId, now],
  );
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    expiresAt: row.expires_at,
    repositoryName: row.repository_name,
    repositoryRole: row.repository_role,
  }));
}

export async function queueInvitationGrant(
  sql: Sql,
  input: {
    invitationId: string;
    organizationId: string;
    repositoryId: string;
    role: "read" | "write";
    now: number;
  },
): Promise<void> {
  const result = await sql.run(
    `INSERT INTO invitation_repo_grants (invitation_id, repository_id, role, created_at)
     SELECT i.id, r.id, ?, ? FROM invitation i JOIN repositories r
       ON r.organization_id = i.organization_id
     WHERE i.id = ? AND i.organization_id = ? AND i.status = 'pending'
       AND r.id = ? AND r.archived = 0
     ON CONFLICT(invitation_id, repository_id) DO UPDATE SET role = excluded.role`,
    [input.role, input.now, input.invitationId, input.organizationId, input.repositoryId],
  );
  if (result.changes !== 1) throw new Error("Could not assign repository access to invitation");
}

/** Better Auth has already verified the email and added the organization member. */
export async function applyInvitationGrants(
  sql: Sql,
  input: {
    invitationId: string;
    organizationId: string;
    userId: string;
    email: string;
    now: number;
  },
): Promise<void> {
  const grants = await sql.all<{ repository_id: string; role: "read" | "write" }>(
    `SELECT g.repository_id, g.role FROM invitation_repo_grants g
     JOIN invitation i ON i.id = g.invitation_id
     JOIN repositories r ON r.id = g.repository_id
     WHERE i.id = ? AND i.organization_id = ? AND lower(i.email) = lower(?)
       AND i.status = 'accepted' AND r.organization_id = i.organization_id
       AND r.archived = 0`,
    [input.invitationId, input.organizationId, input.email],
  );
  for (const grant of grants) {
    const member = await sql.all<{ user_id: string }>(
      `SELECT user_id FROM member WHERE organization_id = ? AND user_id = ?`,
      [input.organizationId, input.userId],
    );
    if (member.length === 0) continue;
    await sql.run(
      `INSERT INTO repository_members (repository_id, user_id, role, created_at)
       SELECT ?, m.user_id, ?, ? FROM member m
       WHERE m.organization_id = ? AND m.user_id = ?
       ON CONFLICT(repository_id, user_id) DO NOTHING`,
      [grant.repository_id, grant.role, input.now, input.organizationId, input.userId],
    );
    await sql.run(
      `DELETE FROM invitation_repo_grants WHERE invitation_id = ? AND repository_id = ?`,
      [input.invitationId, grant.repository_id],
    );
  }
}
