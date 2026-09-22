import type { ForgeStore } from "./store.ts";

export async function recordAuthEvent(
  store: ForgeStore,
  event: { action: "auth.sign_up" | "auth.sign_in"; userId: string },
) {
  await store.insertAudit({
    id: crypto.randomUUID(),
    actorId: event.userId,
    action: event.action,
    repositoryId: null,
    target: event.userId,
    metadata: {},
    requestId: null,
    createdAt: store.now(),
  });
}
