// E2E: full coverage for the merchant route + merchant details page.
//
// Coverage:
//   1. Login, then navigate to `/accounts/merchants`.
//      - Page header, "Total Merchants" pill, and at least one row (or a
//        recognisable empty state) must render.
//   2. Infinite-scroll until at least MERCHANT_COUNT rows are loaded.
//   3. For each of the top N rows:
//        a. Open the global merchant drawer by clicking the row body.
//           - Drawer panel appears, URL contains `?drawer=`,
//           - Business / Contact / Product Information sections are visible,
//           - Live API Keys toggle works, then close the drawer.
//        b. Open the merchant details page by clicking the merchant-account
//           link in the first cell.
//           - URL becomes `/accounts/merchants/merchant-details/:id`,
//           - Header (heading + back button + breadcrumb) is visible,
//           - All five tabs are reachable:
//                merchant-information (default + each pill),
//                product-information,
//                user-management,
//                merchant-settings → ip-whitelist + webhook-url-configuration,
//                merchant-catalogue → categories + products.
//           - Live API Keys popover opens.
//        c. Back to the list to continue with the next row.
//
// Configure the row count via env: MERCHANT_COUNT=20 npx playwright test
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/auth/LoginPage';
import { MerchantsPage } from '../../pages/merchants/MerchantsPage';
import { MerchantDetailsPage } from '../../pages/merchants/MerchantDetailsPage';
import { MerchantDrawerPage } from '../../pages/merchants/MerchantDrawerPage';
import { TEST_CONFIG } from '../../fixtures/test-config';
import { retry } from '../../utils/retry';
import { log } from '../../utils/logger';

const HAS_CREDS = !!TEST_CONFIG.credentials.username && !!TEST_CONFIG.credentials.password;

test.describe('Merchants — full E2E', () => {
  test.skip(!HAS_CREDS, 'TEST_USERNAME / TEST_PASSWORD env vars not set');

  test(`covers list, drawer, and details surface for top ${TEST_CONFIG.merchantCount} merchants`, async ({
    page,
  }) => {
    test.slow();

    const loginPage = new LoginPage(page);
    const merchantsPage = new MerchantsPage(page);
    const detailsPage = new MerchantDetailsPage(page);
    const drawer = new MerchantDrawerPage(page);

    await test.step('login', async () => {
      await loginPage.goto();
      await loginPage.login(TEST_CONFIG.credentials.username, TEST_CONFIG.credentials.password);
    });

    await test.step('navigate to /accounts/merchants', async () => {
      if (!page.url().includes(TEST_CONFIG.routes.merchants)) {
        await merchantsPage.goto();
      } else {
        await merchantsPage.waitForInitialLoad();
      }
      await expect(page).toHaveURL(new RegExp(TEST_CONFIG.routes.merchants));
      await expect(merchantsPage.pageTitle).toBeVisible();
      await expect(merchantsPage.totalMerchantsPill).toBeVisible();
    });

    const initialRowCount = await merchantsPage.rows.count();
    if (initialRowCount === 0) {
      // Empty environment — fail loud rather than silently passing the suite.
      await expect(merchantsPage.emptyState.or(merchantsPage.endOfData)).toBeVisible();
      test.info().annotations.push({
        type: 'note',
        description: 'Empty merchant list — only the empty state was asserted.',
      });
      return;
    }

    let rendered = 0;
    await test.step(`infinite-scroll to ${TEST_CONFIG.merchantCount} rows`, async () => {
      rendered = await merchantsPage.loadAtLeast(TEST_CONFIG.merchantCount);
      expect(rendered, 'No merchant rows rendered').toBeGreaterThan(0);
      if (rendered < TEST_CONFIG.merchantCount) {
        log.warn('Merchant data set smaller than requested target', {
          target: TEST_CONFIG.merchantCount,
          rendered,
        });
      }
    });

    const limit = Math.min(rendered, TEST_CONFIG.merchantCount);
    const snapshots = await merchantsPage.getRowSnapshots(limit);
    expect(snapshots.length, 'Snapshot count mismatch').toBe(limit);

    const failures: { index: number; legalName: string | null; error: string }[] = [];

    for (const snap of snapshots) {
      await test.step(`merchant #${snap.index} (${snap.legalName ?? 'unknown'})`, async () => {
        try {
          // ---- drawer flow ------------------------------------------------
          await retry(
            async () => {
              await merchantsPage.openDrawer(snap.index);
              await drawer.waitForReady();
              await drawer.assertSectionsVisible();
              await drawer.toggleApiKeys();
              await drawer.close();
            },
            { attempts: 2, label: `merchant-drawer-row-${snap.index}` }
          );

          // ---- details page flow -----------------------------------------
          await retry(
            async () => {
              await merchantsPage.openDetailsByRow(snap.index);
              await detailsPage.waitForReady();

              // Default tab — merchant-information + each pill variant.
              await detailsPage.assertMerchantInformationVisible();
              await detailsPage.selectInfoPill('business-details');
              await detailsPage.selectInfoPill('contact-details');
              await detailsPage.selectInfoPill('all');

              // Live API Keys popover.
              await detailsPage.openLiveApiKeys();

              // Product Information.
              await detailsPage.switchTab('product-information');
              await detailsPage.assertProductInformationVisible();

              // User Management.
              await detailsPage.switchTab('user-management');
              await detailsPage.assertUserManagementVisible();

              // Merchant Settings → both sub-items.
              await detailsPage.openSettings('ip-whitelist');
              await detailsPage.assertSettingVisible('ip-whitelist');
              await detailsPage.openSettings('webhook-url-configuration');
              await detailsPage.assertSettingVisible('webhook-url-configuration');

              // Merchant Catalogue → both sub-items.
              await detailsPage.openCatalogue('categories');
              await detailsPage.assertCatalogueVisible('categories');
              await detailsPage.openCatalogue('products');
              await detailsPage.assertCatalogueVisible('products');

              // Back to default tab so the next iteration starts clean.
              await detailsPage.switchTab('merchant-information');

              // Return to the list using the in-page back button so we
              // exercise the navigation contract end-to-end.
              await detailsPage.backToList();
              await merchantsPage.waitForInitialLoad();
            },
            { attempts: 2, label: `merchant-details-row-${snap.index}` }
          );
        } catch (err) {
          failures.push({
            index: snap.index,
            legalName: snap.legalName,
            error: (err as Error).message,
          });
          log.fail(`Merchant #${snap.index} validation failed`, {
            legalName: snap.legalName,
            error: (err as Error).message,
          });
          // Best-effort recovery so the next row still gets a fair run.
          try {
            await drawer.close();
          } catch {
            /* noop */
          }
          if (page.url().match(/\/accounts\/merchants\/merchant-details\/[^/?]+/)) {
            await merchantsPage.returnToList();
          }
        } finally {
          // Ensure subsequent rows are still rendered after navigation churn.
          if (snap.index + 1 < snapshots.length) {
            if (!page.url().includes(TEST_CONFIG.routes.merchants)) {
              await merchantsPage.goto();
            }
            await merchantsPage.loadAtLeast(snap.index + 2);
          }
        }
      });
    }

    expect(
      failures,
      `Validation failed for ${failures.length}/${snapshots.length} merchants:\n` +
        failures.map((f) => `  #${f.index} (${f.legalName}): ${f.error}`).join('\n')
    ).toEqual([]);
  });
});
