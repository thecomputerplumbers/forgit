import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";

import { buildInitSql } from "../apps/web/scripts/init.mjs";
import { signUpDisabled } from "../apps/web/lib/sign-up-policy.ts";

const { hashPassword, verifyPassword } = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
)(
  "better-auth/crypto",
) as typeof import("../packages/auth/node_modules/better-auth/dist/crypto/index.mjs");

describe("first organization init", () => {
  it("closes registration unless explicitly set to false", () => {
    assert.equal(signUpDisabled(undefined), true);
    assert.equal(signUpDisabled("true"), true);
    assert.equal(signUpDisabled("FALSE"), true);
    assert.equal(signUpDisabled("false"), false);
  });
  it("creates one owner with a usable credential and escapes operator input", async () => {
    const database = new DatabaseSync(":memory:");
    database.exec(
      readFileSync(new URL("../apps/web/migrations/0001_init.sql", import.meta.url), "utf8"),
    );
    const ids = {
      user: "user-id",
      account: "account-id",
      organization: "org-id",
      member: "member-id",
    };
    const passwordHash = await hashPassword("correct horse battery staple");
    const sql = buildInitSql({
      email: "OWNER@example.com",
      name: "O'Neil",
      organization: "O'Neil's Company",
      slug: "oneils-company",
      passwordHash,
      ids,
      now: 1000,
    });
    database.exec(sql);
    const owner = database
      .prepare(`SELECT u.name, u.email, a.provider_id AS provider, a.password,
      o.name AS organization, o.slug, m.role
      FROM user u JOIN account a ON a.user_id = u.id
      JOIN member m ON m.user_id = u.id
      JOIN organization o ON o.id = m.organization_id`)
      .get() as Record<string, unknown>;
    assert.deepEqual(
      { ...owner },
      {
        name: "O'Neil",
        email: "owner@example.com",
        provider: "credential",
        password: passwordHash,
        organization: "O'Neil's Company",
        slug: "oneils-company",
        role: "owner",
      },
    );
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM organization").get()?.count, 1);
    assert.equal(
      await verifyPassword({
        hash: String(owner.password),
        password: "correct horse battery staple",
      }),
      true,
    );
    database.close();
  });
});
