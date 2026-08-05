// E2E: internal-user subscription flow, driven by `subscription.json`.
//
// Flow (matches the verbal walkthrough):
//   login → /products
//     → filter: Merchant Account = JSON.filters.merchantName
//               Product Type    = JSON.filters.productType (SUBSCRIPTION)
//     → click product name → /products/subscription/<dasmid>
//     → Plans tab → "Create New Plan" → fill plan form → SUBMIT
//         (the plan name gets a per-run suffix so it's unique + findable)
//     → Subscriptions tab → "Create New Subscription"
//         → fill subscriber + select the plan we just created
//         → CREATE SUBSCRIPTION
//     → assert the new subscription (carrying that plan) lands in the table.
//     → Subscribers tab → assert the new subscriber (name + email) is listed.
//
// Edit `playwright/fixtures/products/subscription.json` to swap merchant /
// product type / plan economics / subscriber — no spec edit required.
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/auth/LoginPage';
import { ProductsListPage } from '../../pages/products/ProductsListPage';
import { SubscriptionProductPage } from '../../pages/products/SubscriptionProductPage';
import { SubscriptionPlanDrawer } from '../../pages/products/SubscriptionPlanDrawer';
import { SubscriptionDrawer } from '../../pages/products/SubscriptionDrawer';
import { loadSubscriptionConfig } from '../../fixtures/products/load';
import { TEST_CONFIG } from '../../fixtures/test-config';
import { log } from '../../utils/logger';

const HAS_CREDS = !!TEST_CONFIG.credentials.username && !!TEST_CONFIG.credentials.password;

test.describe('Products / Subscription — JSON-driven', () => {
  test.skip(!HAS_CREDS, 'TEST_USERNAME / TEST_PASSWORD env vars not set');

  test('creates a plan, then a subscription against that plan', async ({ page }) => {
    test.slow();

    const config = loadSubscriptionConfig();
    // Per-run unique plan name so the subscription form can select this exact
    // plan and the table assertion can't collide with prior runs' plans.
    const runId = Date.now().toString(36);
    const planName = `${config.plan.planName} ${runId}`;

    const loginPage = new LoginPage(page);
    const productsPage = new ProductsListPage(page);
    const subPage = new SubscriptionProductPage(page);
    const planDrawer = new SubscriptionPlanDrawer(page);
    const subDrawer = new SubscriptionDrawer(page);

    await test.step('login as internal user', async () => {
      await loginPage.goto();
      // Arm the gateway-configuration wait BEFORE submitting login — it's the
      // source of the Merchant Account / Product Type filter options.
      await Promise.all([
        page.waitForResponse(
          (resp) =>
            resp.url().includes('/dasconfig/gateway-configuration') && resp.status() === 200,
          { timeout: 60_000 }
        ),
        loginPage.login(TEST_CONFIG.credentials.username, TEST_CONFIG.credentials.password),
      ]);
    });

    await test.step('navigate to /products', async () => {
      await productsPage.goto();
      await expect(page).toHaveURL(new RegExp(TEST_CONFIG.routes.products));
    });

    await test.step('apply Merchant Account + Product Type (SUBSCRIPTION) filters', async () => {
      await productsPage.applyFilters({
        merchantName: config.filters?.merchantName,
        productType: config.filters?.productType,
      });
    });

    await test.step('open the subscription product page', async () => {
      await productsPage.openFirstProductRow(/\/products\/subscription\/[^/]+/);
      await subPage.waitForReady();
      log.info('Subscription spec — landed on subscription page', { url: page.url() });
    });

    await test.step(`create plan "${planName}" from the Plans tab`, async () => {
      await subPage.openCreatePlanDrawer();
      await planDrawer.waitForReady();
      await planDrawer.fillPlan(config.plan, planName);
      const planId = await planDrawer.submitAndAwait();
      log.info('Subscription spec — plan created', { planId, planName });
      // The create-only drawer closes itself on success; the plan-name input
      // detaching is the deterministic "drawer closed" signal.
      await expect(planDrawer.planNameInput).toBeHidden({ timeout: 15_000 });
    });

    await test.step('switch to the Subscriptions tab', async () => {
      await subPage.openSubscriptionsTab();
    });

    await test.step('create a subscription against the new plan', async () => {
      await subPage.openCreateSubscriptionDrawer();
      await subDrawer.waitForReady();
      await subDrawer.fillSubscription(config.subscription, planName);
      const subscriptionId = await subDrawer.submitAndAwait();
      log.info('Subscription spec — subscription created', { subscriptionId, planName });
      // Drawer closes on success.
      await expect(subDrawer.firstNameInput).toBeHidden({ timeout: 15_000 });
    });

    await test.step('verify the subscription (carrying the new plan) lands in the table', async () => {
      // The Subscriptions table shows the plan name per row; the refreshed list
      // should now contain a row for the plan we just subscribed against.
      const row = page.locator('table tbody tr').filter({ hasText: planName }).first();
      await expect(row).toBeVisible({ timeout: 20_000 });
    });

    await test.step('verify the subscriber appears in the Subscribers tab', async () => {
      // Creating a subscription registers/links the subscriber, so the third
      // tab should list them by name + email (e.g. "E2E Subscriber" /
      // "e2e.subscriber@example.com").
      await subPage.openSubscribersTab();
      const fullName = `${config.subscription.firstName} ${config.subscription.lastName}`;
      await subPage.assertSubscriberPresent(fullName, config.subscription.email);
      log.info('Subscription spec — subscriber present in Subscribers tab', {
        fullName,
        email: config.subscription.email,
      });
    });
  });
});
