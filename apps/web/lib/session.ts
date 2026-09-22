import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { Actor, Organization, Services, User } from "@forgit/domain";

import { auth } from "./auth.ts";
import { actorForUser, getServices } from "./forge.ts";

export async function requireForge(): Promise<{
  services: Services;
  actor: Actor;
  user: User;
  organization: Organization | null;
}> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const services = getServices(session.user.email);
  const actor = await actorForUser(services, session.user.id);
  const user = await services.store.getUser(session.user.id);
  if (!user) redirect("/sign-in");
  const organizations = await services.store.listOrganizationsForUser(user.id);
  const active = session.session.activeOrganizationId;
  const organization = organizations.find((org) => org.id === active) ?? organizations[0] ?? null;
  return { services, actor, user, organization };
}

export async function requireOrganization() {
  const context = await requireForge();
  if (!context.organization) redirect("/onboarding");
  return { ...context, organization: context.organization };
}
