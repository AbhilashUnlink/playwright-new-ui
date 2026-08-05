import { expect, type Locator, type Page } from '@playwright/test';
import { TEST_CONFIG } from '../../fixtures/test-config';
import { scrollUntilRowCount } from '../../utils/scroll';
import { log } from '../../utils/logger';

export interface MerchantRowSnapshot {
  index: number;
  /** Primary text in the first cell — the merchant's legal name. */
  legalName: string | null;
}

/**
 * POM for `/accounts/merchants` — the merchant list page.
 *
 * Mirrors `TransactionsPage` in spirit:
 *   - the `.tableContainer` is the scrollable wrapper that fuels infinite scroll,
 *   - `.rows` resolves to the rendered `<tr>` body rows,
 *   - clicking the first cell's primary text navigates to merchant details,
 *   - clicking anywhere else on the row opens the global merchant drawer.
 *
 * The merchant table has no `data-testid` hooks today, so we fall back to
 * structural locators that mirror what `DataTable.tsx` renders.
 */
export class MerchantsPage {
  readonly page: Page;
  readonly tableContainer: Locator;
  readonly rows: Locator;
  readonly skeletonRows: Locator;
  readonly emptyState: Locator;
  readonly endOfData: Locator;
  readonly pageTitle: Locator;
  readonly totalMerchantsPill: Locator;

  constructor(page: Page) {
    this.page = page;
    this.tableContainer = page
      .getByTestId('merchants-table')
      .or(
        page
          .locator('table')
          .first()
          .locator('xpath=ancestor::div[contains(@class, "overflow-auto")][1]')
      )
      .first();
    this.rows = page
      .getByTestId('merchants-row')
      .or(page.locator('table tbody tr').filter({ hasNotText: /no more data|no data|empty/i }))
      .filter({ has: page.locator('td:not([colspan])') });
    this.skeletonRows = page
      .getByTestId('skeleton-row')
      .or(page.locator('[class*="animate-pulse"]'));
    this.emptyState = page.getByText(/no\s*data|empty/i).first();
    this.endOfData = page.getByText(/no more data/i);
    this.pageTitle = page.getByRole('heading', { name: /^merchants$/i }).first();
    this.totalMerchantsPill = page.getByText(/total\s*merchants/i).first();
  }

  async goto() {
    await this.page.goto(TEST_CONFIG.routes.merchants);
    await this.waitForInitialLoad();
  }

  async waitForInitialLoad() {
    await expect(this.pageTitle).toBeVisible({ timeout: 30_000 });
    await expect(async () => {
      const rowCount = await this.rows.count();
      if (rowCount > 0) return;
      // Either a populated table or a recognisable empty state must resolve.
      await expect(this.emptyState.or(this.endOfData)).toBeVisible();
    }).toPass({ timeout: 30_000 });
    await expect(this.skeletonRows).toHaveCount(0, { timeout: 30_000 });
  }

  async loadAtLeast(targetCount: number): Promise<number> {
    const url = this.page.url();
    if (!url.includes(TEST_CONFIG.routes.merchants)) {
      throw new Error(`loadAtLeast called while not on the merchants list. URL: ${url}`);
    }
    log.info(`Merchant list — infinite-scrolling`, { targetCount });
    const rendered = await scrollUntilRowCount(this.page, {
      targetCount,
      rowsLocator: this.rows,
      scrollContainer: this.tableContainer,
      stepPx: TEST_CONFIG.scroll.stepPx,
      settleMs: TEST_CONFIG.scroll.settleMs,
      maxAttempts: TEST_CONFIG.scroll.maxAttempts,
      idleAttemptsBeforeStop: TEST_CONFIG.scroll.idleAttemptsBeforeStop,
    });
    await expect(this.skeletonRows).toHaveCount(0, { timeout: 15_000 });
    return rendered;
  }

  async getRowSnapshots(limit: number): Promise<MerchantRowSnapshot[]> {
    const total = Math.min(await this.rows.count(), limit);
    const snapshots: MerchantRowSnapshot[] = [];
    for (let i = 0; i < total; i++) {
      const row = this.rows.nth(i);
      const text = (await row.locator('td').first().innerText()).trim();
      const legalName = text.split('\n')[0]?.trim() || null;
      snapshots.push({ index: i, legalName });
    }
    return snapshots;
  }

  /**
   * Click the merchant-account link in the first cell to navigate to the
   * merchant details page (`/accounts/merchants/merchant-details/:id`).
   * The first-cell `link-copy` cell is the only navigation trigger; clicks
   * elsewhere open the merchant drawer.
   */
  async openDetailsByRow(index: number): Promise<void> {
    const row = this.rows.nth(index);
    await row.scrollIntoViewIfNeeded();
    const firstCell = row.locator('td').first();
    const navTarget = firstCell
      .getByTestId('merchants-row-name-link')
      .or(firstCell.locator('span.cursor-pointer'))
      .or(firstCell.locator('span').first())
      .first();
    await navTarget.click();
    await this.page.waitForURL(/\/accounts\/merchants\/merchant-details\/[^/]+/, {
      timeout: 15_000,
    });
  }

  /**
   * Click anywhere on the row body (not the first cell's primary link) to
   * open the global merchant drawer (`?drawer=merchant&id=...`).
   */
  async openDrawer(index: number): Promise<void> {
    const row = this.rows.nth(index);
    await row.scrollIntoViewIfNeeded();
    const bodyCell = row.locator('td:not([colspan])').nth(1);
    await bodyCell.click();
    await this.page.waitForURL(/[?&]drawer=/, { timeout: 15_000 });
  }

  async returnToList(): Promise<void> {
    await this.page.goBack();
    await this.waitForInitialLoad();
  }
}
