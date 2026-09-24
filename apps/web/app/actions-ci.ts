"use server";
import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { publicAction } from "@forgit/actions";
import { requireForge } from "@/lib/session";
import { dispatchActions, getActions } from "@/lib/actions";

export async function actionOperation(form: FormData) {
  const { actor } = await requireForge();
  const owner = String(form.get("owner") ?? ""),
    repo = String(form.get("repo") ?? ""),
    op = String(form.get("operation") ?? "");
  const base = `/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions`;
  const args: Record<string, unknown> = Object.fromEntries(form);
  for (const key of ["owner", "repo", "operation"]) delete args[key];
  let destination = base;
  try {
    if (op === "configure") {
      args.enabled = form.get("enabled") === "on";
      args.concurrency = Number(form.get("concurrency"));
      args.retentionDays = Number(form.get("retentionDays"));
      destination = `${base}/settings`;
    }
    if (op === "environment") {
      args.requireApproval = form.get("requireApproval") === "on";
      destination = `${base}/settings`;
    }
    if (op === "secret") {
      if (form.get("remove") === "on") args.value = null;
      delete args.remove;
      destination = `${base}/settings`;
    }
    const result = await publicAction(getActions(), actor, owner, repo, op, args);
    if ("run" in result && result.run && typeof result.run === "object" && "id" in result.run)
      destination = `${base}/${String(result.run.id)}`;
    if (op === "cancel" && env.ACTIONS_WORKER)
      await env.ACTIONS_WORKER.fetch(
        new Request(`https://actions.internal/cancel/${String(args.runId)}`, {
          method: "POST",
          headers: { authorization: `Bearer ${env.ACTIONS_INTERNAL_TOKEN}` },
        }),
      );
    if (["run", "rerun", "retry-events"].includes(op)) await dispatchActions();
  } catch (error) {
    redirect(
      `${destination}?error=${encodeURIComponent(error instanceof Error ? error.message : "Actions request failed")}`,
    );
  }
  redirect(destination);
}
