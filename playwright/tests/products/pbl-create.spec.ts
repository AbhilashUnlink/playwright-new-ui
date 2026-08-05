// E2E: internal-user PBL link creation, driven by `pay-by-link.json`.
//
// Flow (matches the verbal walkthrough):
//   login → /products
//     → filter: Merchant Account = JSON.filters.merchantName
//               Product Type    = JSON.filters.productType
//     → click product name → /products/paybylink/<dasmid>
//     → "Create New Link" → drawer (cart view, empty)
//     → for each item in JSON.items: Add new item → fill form → Add to Cart
//     → Proceed to Link Management (or click the LM tab)
//     → set Expiry Date + optional Link Name
//     → Generate Link (no assertion — per user direction, exit immediately).
//
// Edit `playwright/fixtures/products/pay-by-link.json` to swap merchant /
// product type / cart items / expiry / link name — no spec edit required.
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/auth/LoginPage';
import { ProductsListPage } from '../../pages/products/ProductsListPage';
import { PblOrdersPage } from '../../pages/products/PblOrdersPage';
import { PblCreateDrawer } from '../../pages/products/PblCreateDrawer';
import { loadPayByLinkConfig } from '../../fixtures/products/load';
import { TEST_CONFIG } from '../../fixtures/test-config';
import { log } from '../../utils/logger';

const HAS_CREDS = !!TEST_CONFIG.credentials.username && !!TEST_CONFIG.credentials.password;

test.describe('Products / Pay By Link — JSON-driven', () => {
  test.skip(!HAS_CREDS, 'TEST_USERNAME / TEST_PASSWORD env vars not set');

  test('filters to a merchant + PBL product, adds items, and generates a link', async ({
    page,
  }) => {
    test.slow();

    const config = loadPayByLinkConfig();
    const items = config.items ?? [];
    expect(items.length, 'pay-by-link.json must list at least one cart item').toBeGreaterThan(0);

    const loginPage = new LoginPage(page);
    const productsPage = new ProductsListPage(page);
    const pblOrders = new PblOrdersPage(page);
    const drawer = new PblCreateDrawer(page);

    await test.step('login as internal user', async () => {
      await loginPage.goto();
      // The post-login `dasconfig/gateway-configuration` call is the source of
      // the Merchant Account / DAS MID / Acquirer dropdown options used by the
      // Products filter popover. Arm the response wait BEFORE submitting the
      // login form so we never miss the request, then resolve both together.
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

    await test.step('apply Merchant Account + Product Type filters from JSON', async () => {
      await productsPage.applyFilters({
        merchantName: config.filters?.merchantName,
        productType: config.filters?.productType,
      });
    });

    await test.step('click the product name to open the PBL orders page', async () => {
      // No specific product-name in JSON — use the filtered merchant's only
      // PBL product (any row in cell #1). For multi-product accounts the
      // fixture can be extended later with a `productName` field; for now
      // the spec clicks the first row's name link.
      const firstRow = page.locator('table tbody tr').first();
      await expect(firstRow).toBeVisible({ timeout: 15_000 });
      const nameCell = firstRow.locator('td').first();
      const nameLink = nameCell
        .locator('span.cursor-pointer')
        .or(nameCell.locator('span').first())
        .first();
      await nameLink.click();
      await page.waitForURL(/\/products\/paybylink\/[^/]+/, { timeout: 15_000 });
      log.info('PBL spec — landed on paybylink page', { url: page.url() });
    });

    await test.step('open the Create New Link drawer', async () => {
      await pblOrders.waitForReady();
      await pblOrders.openCreateDrawer();
      await drawer.waitForReady();
    });

    await test.step(`add ${items.length} item(s) to the cart from JSON`, async () => {
      await drawer.addItems(items);
    });

    await test.step('proceed to Link Management', async () => {
      await drawer.proceedToLinkManagementView();
    });

    await test.step('set expiry date + optional link name', async () => {
      // The DasDatePicker pre-fills with today and minDate=today, so when
      // the JSON doesn't override the expiry we leave the prefill alone.
      await drawer.setExpiry(config.expiryDate);
      await drawer.setLinkName(config.linkName);
    });

    await test.step('click Generate Link, wait for the API ID, and verify post-generation block', async () => {
      // `generateLinkAndAwaitId` arms a `waitForResponse` on the PBL mutation
      // (POST `/paybylink/add/DASMID/...` for create, PATCH on regenerate)
      // before clicking, so we resolve only when the server returns the new
      // link record and we can trust the `<id>` in the rendered URL.
      const newLinkId = await drawer.generateLinkAndAwaitId();
      log.info('PBL spec — generate returned link ID', { newLinkId });

      // PostGenerationBlock should render below Regenerate / Deactivate with
      // the QR Code section + Payment Link + public `/paybylink/<id>` URL.
      // Pass `newLinkId` so the URL assertion pins to the exact server-issued
      // ID instead of a generic uuid pattern.
      await drawer.assertPostGenerationVisible(newLinkId);
      log.info('PBL spec — post-generation block rendered with the expected URL.');
    });
  });
});
