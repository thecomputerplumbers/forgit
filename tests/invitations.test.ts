import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";

import type { Sql } from "@forgit/db/sql-store";

import {
  applyInvitationGrants,
  listPendingInvitations,
  queueInvitationGrant,
} from "../apps/web/lib/invitation-grants.ts";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../apps/web/migrations/0001_init.sql", import.meta.url), "utf8"));
  db.exec(
    readFileSync(
      new URL("../apps/web/migrations/0003_invitation_grants.sql", import.meta.url),
      "utf8",
    ),
  );
  const now = 1_700_000_000_000;
  db.prepare(
    `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
     VALUES ('owner', 'Owner', 'owner@example.com', 1, ?, ?),
            ('invitee', 'Invitee', 'scott@example.com', 1, ?, ?),
            ('other', 'Other', 'other@example.com', 1, ?, ?)`,
  ).run(now, now, now, now, now, now);
  db.prepare(
    `INSERT INTO organization (id, name, slug, created_at) VALUES ('org', 'Org', 'org', ?), ('other-org', 'Other', 'other', ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('owner-member', 'org', 'owner', 'owner', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO repositories (id, organization_id, name, description, default_branch, visibility, archived, backing_id, next_pr_number, created_at, updated_at)
     VALUES ('repo', 'org', 'howzer2', '', 'main', 'private', 0, 'repo', 0, ?, ?),
            ('other-repo', 'other-org', 'private', '', 'main', 'private', 0, 'other-repo', 0, ?, ?)`,
  ).run(now, now, now, now);
  db.prepare(
    `INSERT INTO invitation (id, organization_id, email, role, status, expires_at, inviter_id, created_at)
     VALUES ('invite', 'org', 'scott@example.com', 'member', 'pending', ?, 'owner', ?)`,
  ).run(now + 86_400_000, now);
  const sql: Sql = {
    async all(query, params = []) {
      return db.prepare(query).all(...params) as never;
    },
    async run(query, params = []) {
      return { changes: Number(db.prepare(query).run(...params).changes) };
    },
  };
  return { db, sql, now };
}

describe("invitation repository access", () => {
  it("records a role before acceptance, then grants it only to the accepted member", async () => {
    const { db, sql, now } = fixture();
    await assert.rejects(
      queueInvitationGrant(sql, {
        invitationId: "invite",
        organizationId: "org",
        repositoryId: "other-repo",
        role: "write",
        now,
      }),
    );
    await queueInvitationGrant(sql, {
      invitationId: "invite",
      organizationId: "org",
      repositoryId: "repo",
      role: "write",
      now,
    });
    assert.deepEqual(await listPendingInvitations(sql, "org", now), [
      {
        id: "invite",
        email: "scott@example.com",
        expiresAt: now + 86_400_000,
        repositoryName: "howzer2",
        repositoryRole: "write",
      },
    ]);
    assert.equal(db.prepare(`SELECT count(*) AS n FROM repository_members`).get()?.n, 0);

    db.prepare(`UPDATE invitation SET status = 'accepted' WHERE id = 'invite'`).run();
    db.prepare(
      `INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('scott-member', 'org', 'invitee', 'member', ?)`,
    ).run(now);
    await applyInvitationGrants(sql, {
      invitationId: "invite",
      organizationId: "org",
      userId: "other",
      email: "other@example.com",
      now,
    });
    assert.equal(db.prepare(`SELECT count(*) AS n FROM repository_members`).get()?.n, 0);
    await applyInvitationGrants(sql, {
      invitationId: "invite",
      organizationId: "org",
      userId: "invitee",
      email: "scott@example.com",
      now,
    });
    await applyInvitationGrants(sql, {
      invitationId: "invite",
      organizationId: "org",
      userId: "invitee",
      email: "scott@example.com",
      now,
    });
    assert.deepEqual(
      { ...db.prepare(`SELECT repository_id, user_id, role FROM repository_members`).get() },
      {
        repository_id: "repo",
        user_id: "invitee",
        role: "write",
      },
    );
    assert.equal(db.prepare(`SELECT count(*) AS n FROM invitation_repo_grants`).get()?.n, 0);
  });

  it("updates a pending role and keeps the grant until an organization member exists", async () => {
    const { db, sql, now } = fixture();
    const input = {
      invitationId: "invite",
      organizationId: "org",
      repositoryId: "repo",
      now,
    };
    await queueInvitationGrant(sql, { ...input, role: "read" });
    await queueInvitationGrant(sql, { ...input, role: "write" });
    db.prepare(`UPDATE invitation SET status = 'accepted' WHERE id = 'invite'`).run();
    const accepted = {
      invitationId: "invite",
      organizationId: "org",
      userId: "invitee",
      email: "scott@example.com",
      now,
    };
    await applyInvitationGrants(sql, accepted);
    assert.equal(db.prepare(`SELECT count(*) AS n FROM invitation_repo_grants`).get()?.n, 1);
    db.prepare(
      `INSERT INTO member (id, organization_id, user_id, role, created_at)
       VALUES ('scott-member', 'org', 'invitee', 'member', ?)`,
    ).run(now);
    await applyInvitationGrants(sql, accepted);
    assert.equal(db.prepare(`SELECT role FROM repository_members`).get()?.role, "write");
  });
});
