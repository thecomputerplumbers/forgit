import { env } from "cloudflare:workers";
import { ActionsService, ActionsStore } from "@forgit/actions";
import { d1Sql } from "@forgit/db/sql-store";
import { getServices } from "./forge.ts";

export function getActions() {
  return new ActionsService(new ActionsStore(d1Sql(env.DB)), getServices("actions"), {
    enabled: env.ACTIONS_ENABLED === "true",
    encryptionKey: env.ACTIONS_ENCRYPTION_KEY,
    forActor: (actor) => getServices(actor.login),
  });
}
export async function dispatchActions() {
  if (!env.ACTIONS_QUEUE) return;
  const actions = getActions();
  if (env.ACTIONS_ENABLED === "true") {
    await actions.processEvents();
    await actions.reconcilePullRequests();
  }
  for (const run of await actions.store.active()) {
    const healingExpired =
      run.healing?.status === "running" &&
      Date.now() - (run.healing.startedAt ?? run.createdAt) > 30 * 60000;
    const disabled =
      env.ACTIONS_ENABLED !== "true" || !(await actions.store.settings(run.repositoryId)).enabled;
    if (
      (run.status !== "completed" &&
        (Date.now() - run.createdAt > 2 * 60 * 60 * 1000 || disabled)) ||
      healingExpired ||
      (disabled && run.healing?.status === "running")
    ) {
      await actions.finish(
        run.id,
        disabled ? "Actions was disabled" : "Run exceeded the two hour lifecycle limit",
      );
      if (run.healing?.status === "running")
        await actions.store.update(run.id, (current) => {
          current.healing = {
            ...current.healing!,
            status: "failed",
            error: "Healing stopped or timed out",
            completedAt: Date.now(),
          };
        });
      await env.ACTIONS_WORKER?.fetch(
        new Request(`https://actions.internal/cancel/${run.id}`, {
          method: "POST",
          headers: { authorization: `Bearer ${env.ACTIONS_INTERNAL_TOKEN}` },
        }),
      );
    } else if (run.status === "queued") await env.ACTIONS_QUEUE.send({ runId: run.id });
  }
  await expireOutputs(actions);
}

async function expireOutputs(actions: ActionsService) {
  if (!env.ACTIONS_BUCKET) return;
  const rows = await actions.store.sql.all<{ id: string }>(
    `SELECT r.id FROM action_runs r JOIN action_settings s ON s.repository_id=r.repository_id WHERE json_extract(r.document,'$.status')='completed' AND json_extract(r.document,'$.outputExpiredAt') IS NULL AND json_extract(r.document,'$.completedAt') < ? - json_extract(s.document,'$.retentionDays')*86400000 LIMIT 5`,
    [Date.now()],
  );
  for (const { id } of rows) {
    let cursor: string | undefined;
    do {
      const page = await env.ACTIONS_BUCKET.list({ prefix: `runs/${id}/`, cursor, limit: 1000 });
      if (page.objects.length) await env.ACTIONS_BUCKET.delete(page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    await actions.store.update(id, (run) => {
      run.outputExpiredAt = Date.now();
    });
  }
}
