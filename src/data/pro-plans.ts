// The three Pro plans. One source for the /pro page's static price list and
// the checkout buttons in pro.ts; must match the Stripe prices wired to
// STRIPE_PRICE_* in wrangler.jsonc.
export type Plan = "year" | "month" | "pass";

export interface ProPlan {
  plan: Plan;
  label: string;
  price: string;
  note: string;
}

export const PRO_PLANS: ReadonlyArray<ProPlan> = [
  { plan: "year", label: "Pro — A$100 / year", price: "A$100 a year", note: "about five months of the monthly plan" },
  { plan: "month", label: "A$20 / month", price: "A$20 a month", note: "cancel any time" },
  { plan: "pass", label: "7-day pass — A$5", price: "A$5 for 7 days", note: "one-off, nothing to cancel" },
];

// Where Pro is explained anywhere on the site, this is the line.
export const PRO_STATEMENT =
  "Every tool is free. Pro puts your brand on client exports instead of the vishvaddi.com footer, and adds cross-device sync, Studio MP3/stems, and Audio MP3/batch downloads.";
