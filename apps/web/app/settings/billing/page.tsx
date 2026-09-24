import { env } from "cloudflare:workers";
import { notFound } from "next/navigation";

import { Shell } from "@/components/shell";
import { Box, PageHeader } from "@/components/ui";
import { BILLING_PLANS, type BillingPlan } from "@/lib/billing-plans";
import { requireOrganization } from "@/lib/session";
import { d1Sql } from "@forgit/db/sql-store";

export const metadata = { title: "Billing" };

export default async function BillingPage() {
  const { services, organization, user } = await requireOrganization();
  const member = await services.store.getOrgMember(organization.id, user.id);
  if (member?.role !== "owner" && member?.role !== "admin") notFound();

  const sql = d1Sql(env.DB);
  const [account] = await sql.all<{ plan: BillingPlan; status: string }>(
    "SELECT plan,status FROM billing_accounts WHERE organization_id=?",
    [organization.id],
  );
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [usage] = account
    ? await sql.all<{ jobs: number; duration_ms: number }>(
        "SELECT count(*) AS jobs, coalesce(sum(quantity),0) AS duration_ms FROM billing_usage_events WHERE organization_id=? AND occurred_at>=?",
        [organization.id, monthStart.getTime()],
      )
    : [];
  const plan = account && BILLING_PLANS[account.plan];

  return (
    <Shell organization={organization} user={user}>
      <div className="container container-narrow page">
        <PageHeader title="Billing" description={`${organization.name} plan and usage`} />
        <div className="stack" style={{ gap: 24 }}>
          <Box title="Plan">
            {plan ? (
              <p>
                {plan.name} · ${(plan.monthlyCents / 100).toLocaleString("en-US")}/month ·{" "}
                {account.status}
              </p>
            ) : (
              <p>This organization has no hosted billing account.</p>
            )}
          </Box>
          {account ? (
            <Box title="Actions usage this month">
              <p>
                {usage?.jobs ?? 0} completed jobs ·{" "}
                {Math.ceil((usage?.duration_ms ?? 0) / 1000).toLocaleString("en-US")} elapsed
                seconds
              </p>
              <p>Usage is recorded here before pricing or invoicing.</p>
            </Box>
          ) : null}
        </div>
      </div>
    </Shell>
  );
}
