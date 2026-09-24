/** Proposed hosted plans. Prices are cents per organization per month. */
export const BILLING_PLANS = {
  developer: { name: "Developer", monthlyCents: 100 },
  business: { name: "Business", monthlyCents: 5_000 },
  enterprise: { name: "Enterprise", monthlyCents: 100_000 },
} as const;

export type BillingPlan = keyof typeof BILLING_PLANS;
