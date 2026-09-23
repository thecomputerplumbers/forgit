import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { createSqlStore, type Sql } from "@forgit/db/sql-store";
import { redact } from "@forgit/observability";

describe("redaction and rate limits", () => {
  it("strips tokens from logs", () => {
    assert.equal(
      redact("Authorization: Bearer fgp_abcdefghijklmnopqrstuvwxyz failed"),
      "Authorization: [redacted] failed",
    );
    assert.equal(redact("hook whsec_abcdefghijklmnopqrstuvwxyz"), "hook [redacted]");
  });
});

describe("sql store", () => {
  it("allocates pull numbers and compare-and-swaps a merge", async () => {
    const database = new DatabaseSync(":memory:");
    database.exec(
      readFileSync(new URL("../apps/web/migrations/0001_init.sql", import.meta.url), "utf8"),
    );
    const now = 1_700_000_000_000;
    database
      .prepare(
        `INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .run("alice", "Alice", "alice@example.com", now, now);
    database
      .prepare(`INSERT INTO organization (id, name, slug, created_at) VALUES (?, ?, ?, ?)`)
      .run("org", "Acme", "acme", now);
    database
      .prepare(
        `INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run("m1", "org", "alice", "owner", now);
    const sql: Sql = {
      async all(query, params = []) {
        return database.prepare(query).all(...params) as never;
      },
      async run(query, params = []) {
        const result = database.prepare(query).run(...params);
        return { changes: Number(result.changes) };
      },
    };
    const store = createSqlStore(sql);
    await store.upsertLogin("alice", "alice", now);
    await store.insertRepository({
      id: "repo",
      organizationId: "org",
      name: "widget",
      description: "",
      defaultBranch: "main",
      visibility: "private",
      archived: false,
      backingId: "repo",
      nextPrNumber: 0,
      createdAt: now,
      updatedAt: now,
    });
    const ownerAccess = await store.getRepoAccess("acme", "widget", "alice");
    assert.equal(ownerAccess?.repo.id, "repo");
    assert.equal(ownerAccess?.orgMember?.role, "owner");
    assert.equal(ownerAccess?.repoMember, null);
    const anonymousAccess = await store.getRepoAccess("acme", "widget", null);
    assert.equal(anonymousAccess?.repo.id, "repo");
    assert.equal(anonymousAccess?.orgMember, null);
    assert.equal(anonymousAccess?.repoMember, null);
    assert.equal(await store.getRepoAccess("acme", "missing", "alice"), null);
    database
      .prepare(
        `INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .run("bob", "Bob", "bob@example.com", now, now);
    await store.upsertRepoMember({ repositoryId: "repo", userId: "bob", role: "write" });
    const collaboratorAccess = await store.getRepoAccess("acme", "widget", "bob");
    assert.equal(collaboratorAccess?.orgMember, null);
    assert.equal(collaboratorAccess?.repoMember?.role, "write");
    assert.equal(await store.allocatePullNumber("repo"), 1);
    assert.equal(await store.allocatePullNumber("repo"), 2);
    await store.insertPullRequest({
      id: "pr",
      repositoryId: "repo",
      number: 1,
      title: "T",
      body: "",
      authorId: "alice",
      sourceRef: "feature",
      targetRef: "main",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      state: "open",
      mergeSha: null,
      idempotencyKey: null,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      mergedAt: null,
    });
    assert.equal(
      await store.markMerged({
        id: "pr",
        mergeSha: "c".repeat(40),
        expectedHeadSha: "d".repeat(40),
        at: now,
      }),
      null,
    );
    const merged = await store.markMerged({
      id: "pr",
      mergeSha: "c".repeat(40),
      expectedHeadSha: "b".repeat(40),
      idempotencyKey: "k",
      at: now,
    });
    assert.equal(merged?.state, "merged");
    assert.equal(merged?.mergeSha, "c".repeat(40));
    assert.equal((await store.findMergedByIdempotency("repo", "k"))?.id, "pr");
    const decision = await store.takeRate("git:alice", now, 60_000, 1);
    assert.equal(decision.ok, true);
    const blocked = await store.takeRate("git:alice", now + 1, 60_000, 1);
    assert.equal(blocked.ok, false);
  });
});
