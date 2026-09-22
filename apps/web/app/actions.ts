"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ForgeError } from "@forgit/domain";
import { parseScopes } from "@forgit/auth/scopes";

import { requireForge, requireOrganization } from "@/lib/session";

export async function createRepositoryAction(formData: FormData) {
  const { services, actor, organization } = await requireOrganization();
  const name = String(formData.get("name") ?? "");
  try {
    await services.createRepository(actor, {
      owner: organization.slug,
      name,
      description: String(formData.get("description") ?? ""),
      visibility: formData.get("visibility") === "public" ? "public" : "private",
    });
  } catch (error) {
    if (!(error instanceof ForgeError)) throw error;
    redirect(`/new?error=${encodeURIComponent(error.message)}`);
  }
  redirect(`/${organization.slug}/${name}`);
}

export async function createTokenAction(
  formData: FormData,
): Promise<{ plaintext: string } | { error: string }> {
  const { services, actor } = await requireForge();
  try {
    const scopes = parseScopes(
      String(formData.get("scopes") ?? "repo:read")
        .split(/[\s,]+/)
        .filter(Boolean),
    );
    const days = Number(formData.get("days") ?? 0);
    const minted = await services.createToken(actor, {
      name: String(formData.get("name") ?? "token"),
      scopes,
      kind: formData.get("kind") === "machine" ? "machine" : "personal",
      expiresAt: days > 0 ? services.store.now() + days * 86_400_000 : null,
    });
    return { plaintext: minted.plaintext };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not create token" };
  }
}

export async function revokeTokenAction(formData: FormData) {
  const { services, actor } = await requireForge();
  await services.revokeToken(actor, String(formData.get("id") ?? ""));
  redirect("/settings/tokens");
}

export async function openPullAction(formData: FormData) {
  const owner = String(formData.get("owner") ?? "");
  const name = String(formData.get("repo") ?? "");
  const { services, actor } = await requireOrganization();
  try {
    const pr = await services.openPullRequest(actor, owner, name, {
      title: String(formData.get("title") ?? ""),
      body: String(formData.get("body") ?? ""),
      sourceRef: String(formData.get("head") ?? ""),
      targetRef: String(formData.get("base") ?? "main"),
    });
    redirect(`/${owner}/${name}/pull/${pr.number}`);
  } catch (error) {
    if (!(error instanceof ForgeError)) throw error;
    redirect(`/${owner}/${name}/pulls?error=${encodeURIComponent(error.message)}`);
  }
}

export async function reviewAction(formData: FormData) {
  const owner = String(formData.get("owner") ?? "");
  const name = String(formData.get("repo") ?? "");
  const number = Number(formData.get("number") ?? 0);
  const state = String(formData.get("state") ?? "commented") as
    | "approved"
    | "changes_requested"
    | "commented";
  const { services, actor } = await requireOrganization();
  await services.reviewPullRequest(actor, owner, name, number, {
    state,
    body: String(formData.get("body") ?? ""),
  });
  redirect(`/${owner}/${name}/pull/${number}`);
}

export async function commentAction(formData: FormData) {
  const owner = String(formData.get("owner") ?? "");
  const name = String(formData.get("repo") ?? "");
  const number = Number(formData.get("number") ?? 0);
  const { services, actor } = await requireOrganization();
  await services.commentOnPullRequest(actor, owner, name, number, {
    path: String(formData.get("path") ?? "README.md"),
    body: String(formData.get("body") ?? ""),
  });
  redirect(`/${owner}/${name}/pull/${number}`);
}

export async function mergeAction(formData: FormData) {
  const owner = String(formData.get("owner") ?? "");
  const name = String(formData.get("repo") ?? "");
  const number = Number(formData.get("number") ?? 0);
  const { services, actor } = await requireOrganization();
  try {
    await services.mergePullRequest(actor, owner, name, number, { method: "squash" });
  } catch (error) {
    if (!(error instanceof ForgeError)) throw error;
    redirect(`/${owner}/${name}/pull/${number}?error=${encodeURIComponent(error.message)}`);
  }
  redirect(`/${owner}/${name}/pull/${number}`);
}

export async function rulesAction(formData: FormData) {
  const owner = String(formData.get("owner") ?? "");
  const name = String(formData.get("repo") ?? "");
  const { services, actor } = await requireOrganization();
  const { repo } = await services.requireRepo(actor, owner, name, "admin");
  const checks = String(formData.get("checks") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  await services.store.setRules({
    repositoryId: repo.id,
    requiredApprovals: Number(formData.get("approvals") ?? 1),
    requiredChecks: checks,
    dismissStaleReviews: true,
  });
  redirect(`/${owner}/${name}/settings`);
}

export async function memberAction(formData: FormData) {
  const owner = String(formData.get("owner") ?? "");
  const name = String(formData.get("repo") ?? "");
  const { services, actor } = await requireOrganization();
  const { repo } = await services.requireRepo(actor, owner, name, "admin");
  const user = await services.store.getUserByLogin(String(formData.get("login") ?? ""));
  if (!user) redirect(`/${owner}/${name}/settings?error=Unknown%20login`);
  const role = String(formData.get("role") ?? "read") as "read" | "write" | "admin";
  await services.store.upsertRepoMember({ repositoryId: repo.id, userId: user.id, role });
  await services.store.insertAudit({
    id: crypto.randomUUID(),
    actorId: actor.userId,
    action: "repo.member",
    repositoryId: repo.id,
    target: user.login,
    metadata: { role },
    requestId: (await headers()).get("x-request-id"),
    createdAt: services.store.now(),
  });
  redirect(`/${owner}/${name}/settings`);
}

export async function deleteRepositoryAction(formData: FormData) {
  const owner = String(formData.get("owner") ?? "");
  const name = String(formData.get("repo") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (confirm !== name)
    redirect(`/${owner}/${name}/settings?error=Type%20the%20repository%20name%20to%20delete%20it`);
  const { services, actor } = await requireOrganization();
  try {
    await services.destroyRepository(actor, owner, name);
  } catch (error) {
    if (!(error instanceof ForgeError)) throw error;
    redirect(`/${owner}/${name}/settings?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/");
}

export async function archiveAction(formData: FormData) {
  const owner = String(formData.get("owner") ?? "");
  const name = String(formData.get("repo") ?? "");
  const { services, actor } = await requireOrganization();
  await services.archiveRepository(actor, owner, name);
  redirect(`/${owner}/${name}`);
}
