import { expect, type Locator, type Page } from '@playwright/test';
import { TEST_CONFIG } from '../../fixtures/test-config';
import { scrollUntilRowCount } from '../../utils/scroll';
import { log } from '../../utils/logger';

export interface TransactionRowSnapshot {
  index: number;
  refId: string | null;
}

export class TransactionsPage {
  readonly page: Page;
  readonly tableContainer: Locator;
  readonly rows: Locator;
  readonly skeletonRows: Locator;
  readonly emptyState: Locator;
  readonly endOfData: Locator;
  /** The centered "Search transactions" dialog opened by a header quick filter. */
  readonly quickSearchDialog: Locator;

  constructor(page: Page) {
    this.page = page;
    this.tableContainer = page
      .getByTestId('transactions-table')
      .or(
        page
          .locator('table')
          .first()
          .locator('xpath=ancestor::div[contains(@class, "overflow-auto")][1]')
      )
      .first();
    this.rows = page
      .getByTestId('transactions-row')
      .or(
        page
          .locator('table tbody tr:not([data-testid="skeleton-row"])')
          .filter({ hasNotText: /no more data|empty/i })
      )
      .filter({ has: page.locator('td:not([colspan])') });
    this.skeletonRows = page
      .getByTestId('skeleton-row')
      .or(page.locator('[class*="animate-pulse"]'));
    this.emptyState = page.getByText(/no\s*data|empty/i).first();
    this.endOfData = page.getByText(/no more data/i);
    this.quickSearchDialog = page
      .getByRole('dialog', { name: /search transactions/i })
      .or(page.locator('[role="dialog"][aria-label="Search transactions"]'))
      .first();
  }

  async goto() {
    await this.page.goto(TEST_CONFIG.routes.transactions);
    await this.waitForInitialLoad();
  }

  async waitForInitialLoad() {
    await expect(async () => {
      const rowCount = await this.rows.count();
      if (rowCount > 0) return;
      await expect(this.emptyState.or(this.endOfData)).toBeVisible();
    }).toPass({ timeout: 30_000 });
    await expect(this.skeletonRows).toHaveCount(0, { timeout: 30_000 });
  }

  async loadAtLeast(targetCount: number): Promise<number> {
    const url = this.page.url();
    const onListRoute = new RegExp(`${TEST_CONFIG.routes.transactions}(?:/?($|\\?))`).test(url);
    if (!onListRoute) {
      throw new Error(
        `loadAtLeast called while not on the transactions list route. Current URL: ${url}`
      );
    }
    log.info(`Loading rows via infinite scroll`, { targetCount });
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

  async getRowSnapshots(limit: number): Promise<TransactionRowSnapshot[]> {
    const total = Math.min(await this.rows.count(), limit);
    const snapshots: TransactionRowSnapshot[] = [];
    for (let i = 0; i < total; i++) {
      const row = this.rows.nth(i);
      const refId = (await row.locator('td').first().innerText()).split('\n')[0]?.trim() || null;
      snapshots.push({ index: i, refId });
    }
    return snapshots;
  }

  /**
   * Click the transaction-ref-id link in the first cell to navigate to the
   * full details page (`/transactions/:id`). The ref-id span is the only
   * navigation trigger in the row; clicks anywhere else open the drawer.
   */
  async openRow(index: number) {
    const row = this.rows.nth(index);
    await row.scrollIntoViewIfNeeded();
    const firstCell = row.locator('td').first();
    const refLink = firstCell
      .getByTestId('transactions-row-ref-link')
      .or(firstCell.locator('span.cursor-pointer'))
      .or(firstCell.locator('span').first())
      .first();
    await refLink.click();
    await this.page.waitForURL(/\/transactions\/[^/]+(?:[?#]|$)/, { timeout: 15_000 });
  }

  /**
   * Click anywhere on the row body (outside the first cell's ref-id link)
   * to open the global drawer (DrawerManager). This does NOT navigate the
   * page — it adds `?drawer=details&id=...`.
   */
  async openDrawer(index: number) {
    const row = this.rows.nth(index);
    await row.scrollIntoViewIfNeeded();
    // Click a non-first cell — the first cell's ref-id span navigates instead.
    const bodyCell = row.locator('td:not([colspan])').nth(1);
    await bodyCell.click();
    await this.page.waitForURL(/[?&]drawer=/, { timeout: 15_000 });
  }

  async returnToList() {
    await this.page.goBack();
    await this.waitForInitialLoad();
  }

  // ── Header quick filter (per-column search) ─────────────────────────────
  //
  // Every column header carries a funnel button
  // `button[data-column-search-trigger][aria-label="Filter <Column>"]`. Clicking
  // it opens a centered "Search transactions" dialog with a single text box
  // pre-scoped to that column. Applying (Enter) pushes the value into the URL as
  // a column-specific query param (Transaction Ref ID → `?uuid=...`) and the
  // table re-fetches. Clearing the box and re-applying removes the param.

  /** The funnel button in a column header that opens its quick-search dialog. */
  columnFilterTrigger(columnLabel: string): Locator {
    return this.page
      .locator(`button[data-column-search-trigger][aria-label="Filter ${columnLabel}"]`)
      .first();
  }

  /** The text box inside the open quick-search dialog. */
  get quickSearchInput(): Locator {
    return this.quickSearchDialog.locator('input[type="text"]').first();
  }

  /**
   * The FULL (untruncated) Transaction Ref ID for a row. The visible cell text
   * is middle-truncated (e.g. `1c14e1....d9ae3`), so the real value is read from
   * the ref-id span's `title` attribute — this is what the quick filter expects.
   */
  async fullRefId(index: number): Promise<string> {
    const row = this.rows.nth(index);
    await row.scrollIntoViewIfNeeded();
    const title = await row.locator('td').nth(1).locator('span[title]').first().getAttribute('title');
    return (title ?? '').trim();
  }

  /** Open a column's quick-search dialog and assert it is scoped to that column. */
  async openColumnQuickFilter(columnLabel: string) {
    await this.columnFilterTrigger(columnLabel).click();
    await expect(this.quickSearchDialog).toBeVisible();
    await expect(this.quickSearchInput).toHaveAttribute(
      'placeholder',
      new RegExp(`Search ${columnLabel}`, 'i')
    );
  }

  /**
   * Type a value into the open quick-search box and apply it via Enter. Waits for
   * the dialog to close and the table's re-fetch skeletons to clear.
   */
  async applyQuickSearch(value: string) {
    await this.quickSearchInput.fill(value);
    await this.quickSearchInput.press('Enter');
    await expect(this.quickSearchDialog).toBeHidden();
    await expect(this.skeletonRows).toHaveCount(0, { timeout: 15_000 });
  }

  /** Open + apply in one step. */
  async quickSearch(columnLabel: string, value: string) {
    await this.openColumnQuickFilter(columnLabel);
    await this.applyQuickSearch(value);
  }

  /** Reopen a column's quick-search and clear it (empty + Enter), restoring the table. */
  async clearQuickSearch(columnLabel: string) {
    await this.openColumnQuickFilter(columnLabel);
    await this.applyQuickSearch('');
  }
}
