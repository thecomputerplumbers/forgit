# Forgit Cloud billing

The proposed hosted plans have no free tier. Prices are per organization:

| Plan       |   Base price | Usage                                                |
| ---------- | -----------: | ---------------------------------------------------- |
| Developer  |     $1/month | Actions and other metered services billed separately |
| Business   |    $50/month | Actions and other metered services billed separately |
| Enterprise | $1,000/month | Actions and other metered services billed separately |

`apps/web/lib/billing-plans.ts` is the code catalog for base prices. It does not
create a Stripe price or a Metronome contract. A billing account becomes active
only when both provider customer IDs are present. Existing self-hosted
organizations have no billing account and continue to work without one.

`0005_billing.sql` records the elapsed milliseconds of each completed Actions
job for active billing accounts. The event key includes the run attempt and job,
so repeated state updates cannot duplicate usage. Reruns are separate attempts.
The fact is stored in D1 before any external delivery. It is not itself a rated
charge or invoice. The same run can include other billable resources later, such
as artifact storage or agent repair. A cancelled job with a start time uses the
run completion time when the job has no completion time.

`0006_billing_delivery.sql` adds retry and quarantine state for the usage
outbox. The hosted cron can deliver up to 25 pending facts per minute to
Metronome `/v1/ingest`, retaining each fact's transaction ID across retries.
Metronome receives `actions_job_duration_ms` events with a string
`duration_ms` property. Transient failures back off; other 4xx responses are
quarantined for review. Delivery is off until `BILLING_DELIVERY_ENABLED=true`
and `METRONOME_API_KEY` is configured on the hosted web Worker. Do not enable
it before the Metronome customer mapping and billable metric are verified.

## Before public signup

1. Use The Computer Plumbers Stripe account as the seller account and create a
   Metronome account. Confirm the Metronome Startup contract has no annual
   minimum or other fixed fee.
2. Create provider products, prices, and billable metrics. Decide the Actions
   unit price from measured Sandbox costs. Set per-organization spend limits and
   define what happens when a payment fails or a limit is reached.
3. Build checkout, provider customer and contract provisioning, verified
   webhooks, idempotent usage delivery, reconciliation, cancellation, and the
   customer billing and usage pages. Keep provider credentials server-side.
4. Move hosted onboarding through successful payment before activating an
   organization. Keep `DISABLE_SIGN_UP=true` until this flow works end to end.

The existing `git.thecomputerplumbers.com` installation remains a private,
single-organization instance. This migration alone does not charge anyone or
open registration.
