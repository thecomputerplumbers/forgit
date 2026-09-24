import { env } from "cloudflare:workers";
import { requireForge } from "@/lib/session";
import { getActions } from "@/lib/actions";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ owner: string; repo: string; id: string }> },
) {
  const { actor } = await requireForge(),
    { owner, repo, id } = await params;
  const run = await getActions().get(actor, owner, repo, id),
    url = new URL(request.url);
  const artifact = run.artifacts.find((a) => a.name === url.searchParams.get("artifact"));
  const step = run.jobs
    .find((j) => j.id === url.searchParams.get("job"))
    ?.steps.find((s) => s.id === url.searchParams.get("step"));
  const key = artifact?.key ?? step?.logKey;
  if (!key || !env.ACTIONS_BUCKET) return new Response("Not found", { status: 404 });
  const object = await env.ACTIONS_BUCKET.get(key);
  if (!object) return new Response("Expired", { status: 410 });
  return new Response(object.body, {
    headers: {
      "content-type": artifact ? "application/octet-stream" : "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...(artifact
        ? {
            "content-disposition": `attachment; filename="${artifact.name.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
          }
        : {}),
    },
  });
}
