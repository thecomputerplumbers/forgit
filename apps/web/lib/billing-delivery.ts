import type { Sql } from "@forgit/db/sql-store";

type PendingUsage = {
  id: string;
  metronome_customer_id: string;
  organization_id: string;
  repository_id: string;
  action_run_id: string;
  job_id: string;
  metric: string;
  quantity: number;
  occurred_at: number;
  delivery_attempts: number;
};

export function metronomeEvent(row: PendingUsage) {
  return {
    transaction_id: row.id,
    customer_id: row.metronome_customer_id,
    timestamp: new Date(row.occurred_at).toISOString(),
    event_type: row.metric,
    properties: {
      duration_ms: String(row.quantity),
      organization_id: row.organization_id,
      repository_id: row.repository_id,
      action_run_id: row.action_run_id,
      job_id: row.job_id,
    },
  };
}

/** Deliver durable usage facts; the same transaction ID is safe to retry. */
export async function deliverBillingUsage(
  sql: Sql,
  token: string,
  options: { now?: number; fetch?: typeof fetch } = {},
) {
  if (!token) throw new Error("Metronome API token is required");
  const now = options.now ?? Date.now();
  const send = options.fetch ?? fetch;
  const rows = await sql.all<PendingUsage>(
    `SELECT event.id, account.metronome_customer_id, event.organization_id,
      event.repository_id, event.action_run_id, event.job_id, event.metric,
      event.quantity, event.occurred_at, event.delivery_attempts
     FROM billing_usage_events event
     JOIN billing_accounts account ON account.organization_id=event.organization_id
     WHERE account.status='active' AND account.metronome_customer_id IS NOT NULL
       AND event.delivered_at IS NULL AND event.dead_lettered_at IS NULL
       AND event.next_attempt_at<=?
     ORDER BY event.occurred_at, event.id LIMIT 25`,
    [now],
  );
  for (const row of rows) {
    let response: Response | undefined;
    try {
      response = await send("https://api.metronome.com/v1/ingest", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify([metronomeEvent(row)]),
      });
    } catch {
      // Network failures are retried with the original transaction ID.
    }
    if (response?.ok) {
      await sql.run(
        "UPDATE billing_usage_events SET delivered_at=?,delivery_attempts=delivery_attempts+1,delivery_error=NULL WHERE id=? AND delivered_at IS NULL",
        [now, row.id],
      );
      continue;
    }
    const status = response?.status ?? 0;
    const permanent = status >= 400 && status < 500 && status !== 429;
    const delay = Math.min(60 * 60_000, 60_000 * 2 ** Math.min(row.delivery_attempts, 6));
    await sql.run(
      `UPDATE billing_usage_events SET delivery_attempts=delivery_attempts+1,
       delivery_error=?,next_attempt_at=?,dead_lettered_at=?
       WHERE id=? AND delivered_at IS NULL`,
      [status ? `HTTP ${status}` : "network_error", now + delay, permanent ? now : null, row.id],
    );
    if (permanent)
      console.error(JSON.stringify({ event: "billing.usage.rejected", id: row.id, status }));
  }
  return rows.length;
}
