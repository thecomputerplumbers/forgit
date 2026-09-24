import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { it } from "node:test";

import type { Sql } from "@forgit/db/sql-store";
import { deliverBillingUsage } from "../apps/web/lib/billing-delivery.ts";

it("retries usage with the same Metronome transaction ID and quarantines rejected events", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE billing_accounts (organization_id TEXT, status TEXT, metronome_customer_id TEXT);
    CREATE TABLE billing_usage_events (
      id TEXT PRIMARY KEY, organization_id TEXT, repository_id TEXT, action_run_id TEXT,
      job_id TEXT, metric TEXT, quantity INTEGER, occurred_at INTEGER,
      delivered_at INTEGER, delivery_attempts INTEGER DEFAULT 0, delivery_error TEXT,
      next_attempt_at INTEGER DEFAULT 0, dead_lettered_at INTEGER
    );
    INSERT INTO billing_accounts VALUES ('org','active','met_customer');
    INSERT INTO billing_usage_events
      (id,organization_id,repository_id,action_run_id,job_id,metric,quantity,occurred_at)
      VALUES ('run:job:duration','org','repo','run','job','actions_job_duration_ms',2345,1000);`);
  const sql: Sql = {
    async all(query, params = []) {
      return db.prepare(query).all(...params) as never;
    },
    async run(query, params = []) {
      return { changes: Number(db.prepare(query).run(...params).changes) };
    },
  };
  const sent: unknown[] = [];
  let status = 503;
  const send: typeof fetch = async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(null, { status });
  };
  try {
    assert.equal(await deliverBillingUsage(sql, "test-token", { now: 10_000, fetch: send }), 1);
    assert.equal(await deliverBillingUsage(sql, "test-token", { now: 10_001, fetch: send }), 0);
    status = 200;
    assert.equal(await deliverBillingUsage(sql, "test-token", { now: 70_000, fetch: send }), 1);
    assert.deepEqual(sent, [sent[0], sent[0]]);
    assert.deepEqual(sent[0], [
      {
        transaction_id: "run:job:duration",
        customer_id: "met_customer",
        timestamp: new Date(1000).toISOString(),
        event_type: "actions_job_duration_ms",
        properties: {
          duration_ms: "2345",
          organization_id: "org",
          repository_id: "repo",
          action_run_id: "run",
          job_id: "job",
        },
      },
    ]);
    assert.equal(await deliverBillingUsage(sql, "test-token", { now: 80_000, fetch: send }), 0);
    assert.equal(
      db.prepare("SELECT delivered_at FROM billing_usage_events").get()?.delivered_at,
      70_000,
    );

    db.exec(`INSERT INTO billing_usage_events
      (id,organization_id,repository_id,action_run_id,job_id,metric,quantity,occurred_at)
      VALUES ('bad','org','repo','run','job','actions_job_duration_ms',1,2000)`);
    status = 400;
    assert.equal(await deliverBillingUsage(sql, "test-token", { now: 90_000, fetch: send }), 1);
    assert.equal(await deliverBillingUsage(sql, "test-token", { now: 200_000, fetch: send }), 0);
    assert.equal(
      db.prepare("SELECT dead_lettered_at FROM billing_usage_events WHERE id='bad'").get()
        ?.dead_lettered_at,
      90_000,
    );
  } finally {
    db.close();
  }
});
