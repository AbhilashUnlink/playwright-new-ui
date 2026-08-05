// E2E: Transactions → "Transaction Ref ID" header quick filter.
//
// Each column header has a funnel button that opens a centered
// "Search transactions" dialog scoped to that column. This suite exercises the
// Transaction Ref ID quick filter end-to-end against the live table:
//
//   1. Positive — apply a real, full ref id (read from the cell's title attr,
//      because the visible text is middle-truncated) → the table narrows to
//      only rows whose full ref id equals the query, and the URL gains
//      `?uuid=<ref id>`.
//   2. Negative — a non-existent ref id → no rows / empty state.
//   3. Clear — emptying the box restores the table and drops the `uuid` param.
//
// Skipped unless TEST_USERNAME / TEST_PASSWORD are configured (the signed-in
// user must also have visibility of transaction data).
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/auth/LoginPage';
import { TransactionsPage } from '../../pages/transactions/TransactionsPage';
import { TEST_CONFIG } from '../../fixtures/test-config';
import { log } from '../../utils/logger';

const HAS_CREDS = !!TEST_CONFIG.credentials.username && !!TEST_CONFIG.credentials.password;
const COLUMN = 'Transaction Ref ID';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('Transactions — Transaction Ref ID quick filter (table header)', () => {
  test.skip(!HAS_CREDS, 'TEST_USERNAME / TEST_PASSWORD env vars not set');

  test('header quick filter narrows the table to the matching Transaction Ref ID', async ({
    page,
  }) => {
    test.slow();
    const loginPage = new LoginPage(page);
    const transactions = new TransactionsPage(page);

    await test.step('login + open transactions', async () => {
      await loginPage.goto();
      await loginPage.login(TEST_CONFIG.credentials.username, TEST_CONFIG.credentials.password);
      await transactions.goto();
      await expect(page).toHaveURL(new RegExp(TEST_CONFIG.routes.transactions));
    });

    if ((await transactions.rows.count()) === 0) {
      await expect(transactions.emptyState.or(transactions.endOfData)).toBeVisible();
      test.info().annotations.push({
        type: 'note',
        description: 'Empty data set — quick filter not exercised',
      });
      return;
    }

    // Pick a real, full ref id from row 0. The cell text is middle-truncated,
    // so `fullRefId` reads the untruncated value from the span's title attr.
    const refId = await transactions.fullRefId(0);
    log.info('picked ref id', { refId });
    expect(refId, 'row 0 exposes a full Transaction Ref ID').toMatch(/[0-9a-f-]{8,}/i);

    await test.step('open the Transaction Ref ID quick filter', async () => {
      await transactions.openColumnQuickFilter(COLUMN);
      await expect(transactions.quickSearchInput).toHaveAttribute(
        'placeholder',
        /Search Transaction Ref ID/i
      );
    });

    await test.step('apply the full ref id → only matching rows remain', async () => {
      await transactions.applyQuickSearch(refId);
      await expect(page).toHaveURL(new RegExp(`[?&]uuid=${escapeRegExp(refId)}`));

      const matched = await transactions.rows.count();
      expect(matched, 'at least the queried row is shown').toBeGreaterThan(0);
      for (let i = 0; i < matched; i++) {
        expect(await transactions.fullRefId(i), `row ${i} matches the filter`).toBe(refId);
      }
    });

    await test.step('a non-existent ref id yields no matching rows', async () => {
      const bogus = 'zzzzzzzz-0000-0000-0000-000000000000';
      await transactions.quickSearch(COLUMN, bogus);
      await expect(page).toHaveURL(new RegExp(`[?&]uuid=${escapeRegExp(bogus)}`));
      // The positive step already proved the table renders & matches; a
      // non-existent ref id must therefore narrow it to zero data rows.
      await expect(transactions.rows).toHaveCount(0);
    });

    await test.step('clearing the filter restores the table', async () => {
      await transactions.clearQuickSearch(COLUMN);
      await expect(page).not.toHaveURL(/[?&]uuid=/);
      await expect(transactions.rows.first()).toBeVisible();
      expect(await transactions.rows.count()).toBeGreaterThan(0);
    });
  });
});
