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

  /** The single input inside the open quick-search dialog (text box or date-range field). */
  get quickSearchInput(): Locator {
    return this.quickSearchDialog.locator('input').first();
  }

  /**
   * Map every filterable column label → its cell position `{ td, line }`. Header
   * `th` index equals body `td` index; a `th` stacking N columns yields N labels
   * at line 0..N-1 of the same `td`. Built live from the header so it tracks
   * whatever columns the app renders.
   */
  async columnFieldMap(): Promise<Record<string, { td: number; line: number }>> {
    return this.page.evaluate(() => {
      const map: Record<string, { td: number; line: number }> = {};
      document.querySelectorAll('table thead th').forEach((th, td) => {
        th.querySelectorAll('button[data-column-search-trigger]').forEach((b, line) => {
          const label = (b.getAttribute('aria-label') || '').replace(/^Filter\s+/, '');
          if (label) map[label] = { td, line };
        });
      });
      return map;
    });
  }

  /**
   * A column's value in a given row: the `span[title]` full value when present
   * (IDs, merchant, terminal, …), else the visible text of that stacked line.
   */
  async columnCellValue(
    rowIndex: number,
    td: number,
    line: number
  ): Promise<{ title: string | null; text: string }> {
    return this.rows.nth(rowIndex).evaluate(
      (row, pos) => {
        const cell = (row as HTMLElement).querySelectorAll('td')[pos.td] as HTMLElement | undefined;
        if (!cell) return { title: null, text: '' };
        const titled = cell.querySelectorAll('span[title]');
        const title = titled[pos.line]?.getAttribute('title') ?? null;
        const lineDivs = cell.querySelectorAll(':scope > div > div');
        const text = (lineDivs[pos.line]?.textContent ?? cell.textContent ?? '').trim();
        return { title, text };
      },
      { td, line }
    );
  }

  /** Open a column's quick-filter control without asserting its type (text vs date-range). */
  async openColumnFilter(columnLabel: string) {
    const trigger = this.columnFilterTrigger(columnLabel);
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    await expect(this.quickSearchDialog).toBeVisible();
    // Let the dialog's input mount (it animates in) before callers inspect it.
    await this.quickSearchInput.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  }

  /** The placeholder of the open dialog's input — `Search <col>…` (text) or `Select date range…`. */
  async quickSearchPlaceholder(): Promise<string> {
    return (await this.quickSearchInput.getAttribute('placeholder')) ?? '';
  }

  /**
   * Classify the control the open dialog exposes without ever hanging (checks
   * for an input first, so a control that has none returns promptly):
   *   • `text`   — a free-text "Search <col>…" box (returns its placeholder)
   *   • `date`   — a "Select date range…" picker
   *   • `picker` — an options list (enums: Transaction Type, Status, …)
   */
  async quickSearchControlKind(): Promise<{ kind: 'text' | 'date' | 'picker'; hint: string }> {
    // Give the dialog's control a moment to mount (it animates in).
    await this.quickSearchInput.waitFor({ state: 'visible', timeout: 3500 }).catch(() => {});
    if ((await this.quickSearchInput.count()) > 0) {
      const ph = (await this.quickSearchInput.getAttribute('placeholder')) ?? '';
      return { kind: /date range/i.test(ph) ? 'date' : 'text', hint: ph };
    }
    const txt = (await this.quickSearchDialog.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    return { kind: /date range/i.test(txt) ? 'date' : 'picker', hint: txt.slice(0, 100) };
  }

  /** Close the open quick-search dialog via its Close button (Escape as fallback). */
  async closeQuickSearch() {
    const closeBtn = this.quickSearchDialog.getByRole('button', { name: /^close$/i }).first();
    if (await closeBtn.count()) {
      await closeBtn.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
    await expect(this.quickSearchDialog).toBeHidden();
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
