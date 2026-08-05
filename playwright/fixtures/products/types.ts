/**
 * JSON-driven product e2e fixtures — shape definitions.
 *
 * One config per product flow (`pay-by-link.json` for now; subscription / qr
 * follow the same convention). The spec loads the file, the matching POMs
 * read it. Every field is optional with a runtime fallback so a JSON omitting
 * a value still drives a complete run.
 *
 * `DateConfig` mirrors the onboarding fixtures: literal `"today"` or an
 * integer years offset from the current month (`{ yearsOffset: 1 }`).
 */

export type DateConfig = 'today' | { yearsOffset: number };

/** Filters applied on `/products` before clicking the product name. The page
 *  hosts a `Merchant Account` (LegalName, multiSelect) filter and a
 *  `Product Type` (Type, multiSelect with PRODUCT_TYPE_FILTER_OPTIONS) filter.
 *  Provide the visible label strings — both are matched case-insensitively
 *  against the popover's options. */
export interface PblFilterConfig {
  merchantName?: string;
  productType?: string;
}

/** Single cart row driven through the Add Item drawer (`AddItemPanel` →
 *  `PblItemForm`). Strings everywhere because the form's number inputs are
 *  `<input type="number">` and accept text. `currency` matches the merchant's
 *  configured `TransactionCCY` list; omit to let the form keep its default. */
export interface PblItemConfig {
  productName: string;
  quantity: string;
  price: string;
  currency?: string;
  requireImage?: boolean;
}

/** Top-level Pay-By-Link e2e config (`pay-by-link.json`). */
export interface PblOrderConfig {
  filters?: PblFilterConfig;
  /** Cart items — the spec clicks "Add new item" once per entry. */
  items?: PblItemConfig[];
  /** Optional link name typed into Link Management. Omit / empty for none. */
  linkName?: string;
  /** Expiry date pushed into the picker. Defaults to `{ yearsOffset: 1 }`
   *  when omitted so the link is comfortably valid even on a freshly merged
   *  branch where the date picker's minDate is today. */
  expiryDate?: DateConfig;
}

/* ── Subscription product e2e (`subscription.json`) ─────────────────────── */

/** Plan-form values driven through the `subscription-plan-create` drawer
 *  (`SubscriptionPlanForm`). Strings everywhere — `amount` is an
 *  `<input type="number">` that accepts text. `billingCycle` / `currency`
 *  match the visible Select option labels (e.g. "Monthly", "HKD"). The spec
 *  appends a per-run suffix to `planName` so each run creates a uniquely
 *  named plan it can then select in the subscription form. */
export interface SubscriptionPlanConfig {
  planName: string;
  /** Billing-cycle option label: Daily | Weekly | Monthly | Quarterly |
   *  Semi-Annually | Annually. */
  billingCycle: string;
  /** Currency option label — must be one the product exposes (e.g. HKD). */
  currency: string;
  amount: string;
  comments?: string;
}

/** Subscription-form values driven through the `subscription-create` drawer
 *  (`SubscriptionForm`). The plan is selected by name at runtime (the plan the
 *  spec just created), so it isn't part of the JSON. */
export interface SubscriptionEntityConfig {
  firstName: string;
  lastName: string;
  email: string;
  /** Start-date option label: "Immediately" (default) or "Specific Date".
   *  Only "Immediately" is wired in the helper today (no extra date field). */
  startDate?: string;
  /** End-date option label: "Forever" (default), "After", or "Specific Date".
   *  "After" requires `cycleCount`; the others need no extra entry beyond the
   *  always-required link expiry. */
  endDate?: string;
  /** Cycle count — used only when `endDate` is "After". */
  cycleCount?: string;
  /** Link expiry date (always required by the form). Defaults to
   *  `{ yearsOffset: 1 }` when omitted. */
  linkExpiry?: DateConfig;
  /** Tick "Send Subscription Link to subscriber". Defaults to false. */
  notifyCustomer?: boolean;
}

/** Top-level Subscription e2e config (`subscription.json`). Reuses
 *  `PblFilterConfig` for the `/products` filter (merchant + product type). */
export interface SubscriptionConfig {
  filters?: PblFilterConfig;
  plan: SubscriptionPlanConfig;
  subscription: SubscriptionEntityConfig;
}
