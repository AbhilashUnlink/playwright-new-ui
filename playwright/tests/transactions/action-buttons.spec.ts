import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/auth/LoginPage';
import { TransactionsPage } from '../../pages/transactions/TransactionsPage';
import { TransactionDetailsPage } from '../../pages/transactions/TransactionDetailsPage';
import { TransactionDrawerPage } from '../../pages/transactions/TransactionDrawerPage';
import { TEST_CONFIG } from '../../fixtures/test-config';
import {
  validateRowActions,
  validateDrawerActions,
  assertSurfacesAgree,
} from '../../utils/validators';
import { retry } from '../../utils/retry';
import { log } from '../../utils/logger';

/**
 * End-to-end coverage for transaction action buttons:
 *   1. Authenticate via the login page.
 *   2. Land on Transactions, wait for the table to populate.
 *   3. Infinite-scroll until at least TRANSACTION_COUNT rows are loaded.
 *   4. For each row:
 *        a. Open the global drawer (click the transaction-ref-id link).
 *        b. Validate drawer action button visibility/enabled state.
 *        c. Close the drawer.
 *        d. Open the details page (click the row body) and re-validate.
 *        e. Assert the drawer and details page agree on every action.
 *
 * Configure the row count via env: TRANSACTION_COUNT=50 npx playwright test
 */

test.describe('Transactions table — action button visibility', () => {
  test(`validates top ${TEST_CONFIG.transactionCount} rows`, async ({ page }) => {
    test.slow();

    const loginPage = new LoginPage(page);
    const transactionsPage = new TransactionsPage(page);
    const detailsPage = new TransactionDetailsPage(page);
    const drawer = new TransactionDrawerPage(page);

    await test.step('login', async () => {
      await loginPage.goto();
      await loginPage.login(TEST_CONFIG.credentials.username, TEST_CONFIG.credentials.password);
    });

    await test.step('navigate to transactions', async () => {
      if (!page.url().includes(TEST_CONFIG.routes.transactions)) {
        await transactionsPage.goto();
      } else {
        await transactionsPage.waitForInitialLoad();
      }
      await expect(page).toHaveURL(new RegExp(TEST_CONFIG.routes.transactions));
    });

    let rendered = 0;
    await test.step(`infinite-scroll to ${TEST_CONFIG.transactionCount} rows`, async () => {
      rendered = await transactionsPage.loadAtLeast(TEST_CONFIG.transactionCount);
      expect(rendered, 'No rows rendered after scroll').toBeGreaterThan(0);
      if (rendered < TEST_CONFIG.transactionCount) {
        log.warn('Dataset smaller than requested target', {
          target: TEST_CONFIG.transactionCount,
          rendered,
        });
      }
    });

    const limit = Math.min(rendered, TEST_CONFIG.transactionCount);
    const snapshots = await transactionsPage.getRowSnapshots(limit);
    expect(snapshots.length, 'Snapshot count mismatch').toBe(limit);

    const failures: { index: number; refId: string | null; error: string }[] = [];

    for (const snap of snapshots) {
      await test.step(`row #${snap.index} (${snap.refId ?? 'unknown'})`, async () => {
        try {
          const drawerVisibility = await retry(
            async () => {
              await transactionsPage.openDrawer(snap.index);
              await drawer.waitForReady();
              const visibility = await validateDrawerActions(drawer, snap.index, snap.refId);
              await drawer.close();
              return visibility;
            },
            { attempts: 2, label: `drawer-row-${snap.index}` }
          );

          const detailsVisibility = await retry(
            async () => {
              await transactionsPage.openRow(snap.index);
              await detailsPage.waitForReady();
              const visibility = await validateRowActions(detailsPage, snap.index, snap.refId);
              await transactionsPage.returnToList();
              return visibility;
            },
            { attempts: 2, label: `details-row-${snap.index}` }
          );

          assertSurfacesAgree(drawerVisibility, detailsVisibility, snap.index, snap.refId);
        } catch (err) {
          failures.push({
            index: snap.index,
            refId: snap.refId,
            error: (err as Error).message,
          });
          log.fail(`Row #${snap.index} validation failed`, {
            refId: snap.refId,
            error: (err as Error).message,
          });
          try {
            await drawer.close();
          } catch {
            /* noop */
          }
          if (page.url().match(/\/transactions\/[^/?]+/)) {
            await transactionsPage.returnToList();
          }
        } finally {
          if (snap.index + 1 < snapshots.length) {
            if (!page.url().includes(TEST_CONFIG.routes.transactions)) {
              await transactionsPage.goto();
            } else if (page.url().match(/\/transactions\/[^/?]+/)) {
              await transactionsPage.returnToList();
            }
            await transactionsPage.loadAtLeast(snap.index + 2);
          }
        }
      });
    }

    expect(
      failures,
      `Validation failed for ${failures.length}/${snapshots.length} rows:\n` +
        failures.map((f) => `  #${f.index} (${f.refId}): ${f.error}`).join('\n')
    ).toEqual([]);
  });
});
