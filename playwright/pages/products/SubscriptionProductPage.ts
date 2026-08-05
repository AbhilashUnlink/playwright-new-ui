import { expect, type Locator, type Page } from '@playwright/test';

/**
 * POM for `/products/subscription/:dasmid` — the per-merchant Subscription
 * page (`SubscriptionPage.tsx`).
 *
 * Layout: a header strip + a card with three tabs rendered as `<button>`s
 * (Subscription Plans / Subscriptions / Subscribers). Each tab body is a
 * DataTable with a ghost "CREATE NEW …" button in its section header:
 *   - Plans tab        → "CREATE NEW PLAN"         → `subscription-plan-create`
 *   - Subscriptions tab → "CREATE NEW SUBSCRIPTION" → `subscription-create`
 *
 * The tab is reflected in the `?tab=` query param (plans is the default and
 * carries no param). Drawers open via the drawer registry (Redux), not the
 * URL — so the POMs wait on the drawer's own markers, not a route change.
 */
export class SubscriptionProductPage {
  readonly page: Page;
  readonly plansTab: Locator;
  readonly subscriptionsTab: Locator;
  readonly subscribersTab: Locator;
  readonly createPlanButton: Locator;
  readonly createSubscriptionButton: Locator;
  readonly subscribersHeading: Locator;

  constructor(page: Page) {
    this.page = page;
    // Tabs share their label with the section heading ("Subscription Plans",
    // "Subscriptions"); scope to the tab strip by matching the tab buttons,
    // which sit in the card header above the table. `getByRole('button')` with
    // the exact tab label is unambiguous because the section headings are
    // `<h2>`, not buttons.
    this.plansTab = page.getByRole('button', { name: /^subscription\s*plans$/i }).first();
    this.subscriptionsTab = page.getByRole('button', { name: /^subscriptions$/i }).first();
    this.subscribersTab = page.getByRole('button', { name: /^subscribers$/i }).first();
    this.createPlanButton = page.getByRole('button', { name: /^create\s*new\s*plan$/i }).first();
    this.createSubscriptionButton = page
      .getByRole('button', { name: /^create\s*new\s*subscription$/i })
      .first();
    // Subscribers tab has no CTA — its <h2> heading is the ready signal.
    this.subscribersHeading = page.getByRole('heading', { name: /^subscribers$/i }).first();
  }

  async waitForReady() {
    // The h1 carries the merchant name, not "Subscription" — so anchor on the
    // tab strip (unique to this page) and the default Plans tab's CTA, which
    // together prove the page and the plans tab body have rendered.
    await expect(this.plansTab).toBeVisible({ timeout: 30_000 });
    await expect(this.createPlanButton).toBeVisible({ timeout: 15_000 });
  }

  /** Open the Subscriptions tab and wait for its "CREATE NEW SUBSCRIPTION"
   *  CTA — proves the tab switched and the subscriptions table mounted. */
  async openSubscriptionsTab() {
    await this.subscriptionsTab.click();
    await expect(this.page).toHaveURL(/[?&]tab=subscriptions\b/, { timeout: 10_000 });
    await expect(this.createSubscriptionButton).toBeVisible({ timeout: 15_000 });
  }

  /** Open the Subscribers tab (no CTA) and wait for its heading + table. */
  async openSubscribersTab() {
    await this.subscribersTab.click();
    await expect(this.page).toHaveURL(/[?&]tab=subscribers\b/, { timeout: 10_000 });
    await expect(this.subscribersHeading).toBeVisible({ timeout: 15_000 });
  }

  /**
   * Assert a subscriber row is present in the Subscribers table. Matches on
   * the email (unique per subscriber) and the full name — both are rendered
   * in the row (`E2E Subscriber` / `e2e.subscriber@example.com`). The list can
   * paginate, so this waits for the row to materialise.
   */
  async assertSubscriberPresent(fullName: string, email: string) {
    const row = this.page
      .locator('table tbody tr')
      .filter({ hasText: email })
      .filter({ hasText: fullName })
      .first();
    await expect(row).toBeVisible({ timeout: 20_000 });
  }

  /** Open the create-plan drawer. The header reads "New Subscription Plan"
   *  (`subscription_plan_drawer.new_plan_title`) and the Plan Name input
   *  (`#planName`) mounts — both are unique to the create form. */
  async openCreatePlanDrawer() {
    await this.createPlanButton.click();
    await expect(this.page.getByText(/new\s*subscription\s*plan/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(this.page.locator('#planName')).toBeVisible({ timeout: 15_000 });
  }

  /** Open the create-subscription drawer. Header reads "New Subscription"
   *  (`subscription_drawer.new_subscription_title`); `#firstName` mounts. */
  async openCreateSubscriptionDrawer() {
    await this.createSubscriptionButton.click();
    await expect(this.page.getByText(/new\s*subscription\b/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(this.page.locator('#firstName')).toBeVisible({ timeout: 15_000 });
  }
}
