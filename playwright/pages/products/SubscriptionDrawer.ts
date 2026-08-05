import { expect, type Locator, type Page } from '@playwright/test';
import type { DateConfig, SubscriptionEntityConfig } from '../../fixtures/products/types';
import { pickDasFormDate, selectDasFormOption } from '../../utils/dasForm';
import { log } from '../../utils/logger';

/**
 * POM for the create-subscription drawer (`drawerRegistry: subscription-create`,
 * `SubscriptionDrawer` in create-only mode → `SubscriptionForm`).
 *
 * Fields (DasForm, by `id={field.name}`):
 *   - `#firstName` `#lastName` `#email`  text inputs
 *   - `#subscriptionPlan`                Select — the active plans for the
 *                                        merchant (we select the plan the spec
 *                                        just created, by name)
 *   - `#startDate`                       Select (Immediately | Specific Date)
 *   - `#subscriptionStartsAt`            date — only when start = Specific Date
 *   - `#subscriptionType`                Select (Forever | After | Specific Date)
 *   - `#subscriptionEndsAt`              date  — only when end = Specific Date
 *   - `#maxCycleCount`                   number — only when end = After
 *   - `#linkExpiry`                      date (always required)
 *   - notification checkbox (optional)
 *
 * Footer submit is "CREATE SUBSCRIPTION" bound to `form="subscription-form"`.
 */
export class SubscriptionDrawer {
  readonly page: Page;
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly emailInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.firstNameInput = page.locator('#firstName');
    this.lastNameInput = page.locator('#lastName');
    this.emailInput = page.locator('#email');
    this.submitButton = page
      .getByRole('button', { name: /^create\s*subscription$/i })
      .and(page.locator('[form="subscription-form"]'))
      .first();
  }

  async waitForReady() {
    await expect(this.firstNameInput).toBeVisible({ timeout: 15_000 });
  }

  /**
   * Fill the create-subscription form. `planName` is the exact plan label to
   * pick in the Subscription Plan select — the plan the spec created moments
   * earlier (now in the merchant's active-plans list).
   */
  async fillSubscription(config: SubscriptionEntityConfig, planName: string) {
    log.info('Subscription drawer — filling create form', {
      email: config.email,
      planName,
      startDate: config.startDate,
      endDate: config.endDate,
    });

    await this.firstNameInput.fill(config.firstName);
    await this.lastNameInput.fill(config.lastName);
    await this.emailInput.fill(config.email);

    // Plan select — pick the plan we just created, by its unique name. The
    // option appears because `useActiveSubscriptionPlans` refetched on drawer
    // mount and the new plan is active.
    const planOption = this.page
      .locator('#subscriptionPlan')
      .or(this.page.locator('label', { hasText: /subscription\s*plan/i }));
    await expect(planOption.first()).toBeVisible({ timeout: 15_000 });
    await selectDasFormOption(this.page, 'subscriptionPlan', planName);

    // Start date — default "Immediately" (no extra date field).
    const startDate = config.startDate ?? 'Immediately';
    await selectDasFormOption(this.page, 'startDate', startDate);
    if (/specific/i.test(startDate)) {
      await pickDasFormDate(this.page, 'subscriptionStartsAt', resolveYears(config.linkExpiry));
    }

    // End date — default "Forever" (no extra field). "After" reveals the cycle
    // count input; "Specific Date" reveals an end-date picker.
    const endDate = config.endDate ?? 'Forever';
    await selectDasFormOption(this.page, 'subscriptionType', endDate);
    if (/after/i.test(endDate)) {
      await this.page.locator('#maxCycleCount').fill(config.cycleCount ?? '3');
    } else if (/specific/i.test(endDate)) {
      await pickDasFormDate(this.page, 'subscriptionEndsAt', resolveYears(config.linkExpiry));
    }

    // Link expiry is always required.
    await pickDasFormDate(this.page, 'linkExpiry', resolveYears(config.linkExpiry));

    if (config.notifyCustomer) {
      await this.page
        .getByLabel(/send\s*subscription\s*link/i)
        .first()
        .check();
    }
  }

  /**
   * Submit and resolve on the create API response (POST
   * `entities/recurring/subscription/create`). The list refetch hits
   * `…/subscription/list`, a distinct path, so this resolves on the mutation
   * alone. Returns the created subscription id when present.
   */
  async submitAndAwait(): Promise<string> {
    const responsePromise = this.page.waitForResponse(
      (res) =>
        /recurring\/subscription\/create/i.test(res.url()) &&
        res.request().method() === 'POST' &&
        res.ok(),
      { timeout: 30_000 }
    );

    await this.submitButton.click();

    const response = await responsePromise;
    const body = (await response.json().catch(() => null)) as {
      id?: string;
      ID?: string;
      data?: { id?: string; ID?: string };
    } | null;
    const newId = body?.data?.id ?? body?.data?.ID ?? body?.id ?? body?.ID ?? '';
    log.info('Subscription drawer — subscription created', { newId });
    return newId;
  }
}

/** Years-offset for date pickers, defaulting to +1 year so the link/expiry is
 *  comfortably valid. */
function resolveYears(expiry: DateConfig | undefined): number {
  if (!expiry || expiry === 'today') return 1;
  return expiry.yearsOffset > 0 ? expiry.yearsOffset : 1;
}
