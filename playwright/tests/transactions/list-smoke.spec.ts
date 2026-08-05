// E2E: Transactions list smoke test.
//
// Coverage:
//   1. After login, /transactions loads and the table renders rows
//      (or surfaces a recognisable empty state).
//   2. Opening the global drawer via the first row's ref-id link works:
//      URL gains ?drawer=, the drawer panel becomes visible, and we can close it.
//   3. Opening the details page via a row body click navigates to
//      /transactions/:id and we can navigate back.
//
// This is intentionally lighter than action-buttons.spec.ts — that suite
// validates per-row cross-surface action visibility for N rows. This one
// just guarantees the list page loads and the two primary entry points
// (drawer + details page) work end-to-end.
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/auth/LoginPage';
import { TransactionsPage } from '../../pages/transactions/TransactionsPage';
import { TransactionDrawerPage } from '../../pages/transactions/TransactionDrawerPage';
import { TEST_CONFIG } from '../../fixtures/test-config';

// Skip the suite when credentials are not configured.
const HAS_CREDS = !!TEST_CONFIG.credentials.username && !!TEST_CONFIG.credentials.password;

test.describe('Transactions list — smoke', () => {
  test.skip(!HAS_CREDS, 'TEST_USERNAME / TEST_PASSWORD env vars not set');

  test('loads the transactions list and the row → drawer flow works', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const transactionsPage = new TransactionsPage(page);
    const drawer = new TransactionDrawerPage(page);

    await test.step('login', async () => {
      await loginPage.goto();
      await loginPage.login(TEST_CONFIG.credentials.username, TEST_CONFIG.credentials.password);
    });

    await test.step('navigate to /transactions', async () => {
      if (!page.url().includes(TEST_CONFIG.routes.transactions)) {
        await transactionsPage.goto();
      } else {
        await transactionsPage.waitForInitialLoad();
      }
      await expect(page).toHaveURL(new RegExp(TEST_CONFIG.routes.transactions));
    });

    const rowCount = await transactionsPage.rows.count();
    if (rowCount === 0) {
      // Some staging environments seed empty merchants — fail gracefully but
      // explicitly so we see the empty case in CI rather than masking it.
      await expect(transactionsPage.emptyState.or(transactionsPage.endOfData)).toBeVisible();
      test.info().annotations.push({
        type: 'note',
        description: 'Empty data set — only empty state asserted',
      });
      return;
    }

    await test.step('open the global drawer from the first row', async () => {
      await transactionsPage.openDrawer(0);
      await drawer.waitForReady();
      // URL has the ?drawer= marker; the drawer page object's waitForReady()
      // already asserted the panel is visible.
      await expect(page).toHaveURL(/[?&]drawer=/);
      await drawer.close();
    });

    await test.step('open the details page from the same row', async () => {
      await transactionsPage.openRow(0);
      await expect(page).toHaveURL(/\/transactions\/[^/]+/);
      await transactionsPage.returnToList();
      await expect(page).toHaveURL(new RegExp(TEST_CONFIG.routes.transactions));
    });
  });
});
