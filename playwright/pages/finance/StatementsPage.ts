import { expect, type Locator, type Page } from '@playwright/test';
import { TEST_CONFIG } from '../../fixtures/test-config';
import { scrollUntilRowCount } from '../../utils/scroll';
import { log } from '../../utils/logger';

/** A filter value control type, matching the app's `FilterField['type']`. */
export type StatementsFilterType = 'text' | 'select' | 'multiSelect' | 'dateRange';

/** Network endpoint fragments for the three bulk/edit mutations. */
export const STATEMENT_ENDPOINTS = {
  approveMultiple: 'statements/statement/approve-multiple',
  updateWiredStatus: 'statements/statement/update-wired-status',
  // Edit posts the singular `approve` endpoint (NOT `approve-multiple`).
  edit: /statements\/statement\/approve(?!-multiple)/,
} as const;

/**
 * Page object for the Finance → Statements (Merchant Statements) list.
 *
 * Wraps the shared `DataTable` (testId="statements" → `statements-table` /
 * `statements-row`), the bulk-action chips (Approve / Wired Status / Download),
 * the row-select checkboxes, and the Advanced-Filters popover. The filter
 * helpers drive the app's custom portaled `Select` / `MultiSelect` menus
 * (`[data-filter-portal]`) rather than native form controls.
 */
export class StatementsPage {
  readonly page: Page;
  readonly tableContainer: Locator;
  readonly rows: Locator;
  readonly skeletonRows: Locator;
  readonly headerCells: Locator;
  readonly emptyState: Locator;
  readonly endOfData: Locator;

  // Bulk-action chips (aria-label / accessible name from i18n: APPROVE,
  // WIRED STATUS). They live in the tab-strip `actions` slot.
  readonly approveChip: Locator;
  readonly wiredStatusChip: Locator;
  readonly filterTrigger: Locator;

  constructor(page: Page) {
    this.page = page;
    this.tableContainer = page
      .getByTestId('statements-table')
      .or(
        page.locator('table').first().locator('xpath=ancestor::div[contains(@class,"overflow")][1]')
      )
      .first();
    this.rows = page.getByTestId('statements-row');
    this.skeletonRows = page
      .getByTestId('skeleton-row')
      .or(page.locator('[class*="animate-pulse"]'));
    this.headerCells = this.tableContainer.locator('thead th');
    // The DataTable empty state renders `table.empty_state` = "No records
    // found"; `no more data` is the end-of-scroll marker. Match both.
    this.emptyState = page.getByText(/no records found|no\s*data|empty/i).first();
    this.endOfData = page.getByText(/no more data/i);

    this.approveChip = page.getByRole('button', { name: /^approve$/i });
    this.wiredStatusChip = page.getByRole('button', { name: /^wired\s*status$/i });
    this.filterTrigger = page.getByRole('button', { name: /filter/i }).first();
  }

  async goto() {
    // Default tab is Merchant Statements; pin it explicitly so a stale
    // `?tab=holidays` from a previous run can't bleed in.
    await this.page.goto(`${TEST_CONFIG.routes.statements}?tab=merchant`);
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

  async rowCount(): Promise<number> {
    return this.rows.count();
  }

  async loadAtLeast(targetCount: number): Promise<number> {
    log.info('Loading statement rows via infinite scroll', { targetCount });
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

  // ── Column reading ─────────────────────────────────────────────────────

  /**
   * Resolve a body-cell column index from its header text. Indices include the
   * leading select-checkbox column (empty header), so they line up 1:1 with
   * each row's `<td>` list.
   */
  async columnIndex(headerPattern: RegExp): Promise<number> {
    const count = await this.headerCells.count();
    for (let i = 0; i < count; i++) {
      const text = (await this.headerCells.nth(i).innerText()).trim();
      if (headerPattern.test(text)) return i;
    }
    throw new Error(`Column header matching ${headerPattern} not found`);
  }

  /** The text of one body cell (primary line only) at [rowIndex][colIndex]. */
  async cellText(rowIndex: number, colIndex: number): Promise<string> {
    const cell = this.rows.nth(rowIndex).locator('td').nth(colIndex);
    return (await cell.innerText()).split('\n')[0]?.trim() ?? '';
  }

  /** Every visible row's primary text for the column matching `headerPattern`. */
  async columnValues(headerPattern: RegExp): Promise<string[]> {
    const colIndex = await this.columnIndex(headerPattern);
    const total = await this.rows.count();
    const out: string[] = [];
    for (let i = 0; i < total; i++) out.push(await this.cellText(i, colIndex));
    return out;
  }

  // ── Selection ──────────────────────────────────────────────────────────

  /** Toggle the header "select all visible" checkbox. */
  async selectAllVisible() {
    const selectAll = this.page.getByRole('checkbox', { name: /select all/i }).first();
    await selectAll.scrollIntoViewIfNeeded();
    await selectAll.check();
  }

  async clearSelection() {
    const selectAll = this.page.getByRole('checkbox', { name: /select all/i }).first();
    if (await selectAll.isChecked()) await selectAll.uncheck();
  }

  rowCheckbox(index: number): Locator {
    return this.rows.nth(index).getByRole('checkbox').first();
  }

  /**
   * Select rows one at a time until the given chip's eligible count reaches 1,
   * leaving exactly one eligible row selected. Rows that don't bump the count
   * (ineligible for that action) are unchecked again. Returns the selected row
   * index, or -1 if no visible row is eligible. Keeps mutations minimal — the
   * caller acts on a single row rather than every eligible one.
   */
  async selectOneEligibleFor(chip: Locator): Promise<number> {
    await this.clearSelection();
    const total = await this.rows.count();
    for (let i = 0; i < total; i++) {
      const box = this.rowCheckbox(i);
      await box.scrollIntoViewIfNeeded();
      await box.check();
      if ((await this.chipCount(chip)) >= 1) return i;
      await box.uncheck();
    }
    return -1;
  }

  /** Numeric badge on a bulk-action chip = count of eligible selected rows. */
  async chipCount(chip: Locator): Promise<number> {
    const badge = chip.locator('span').last();
    const text = (await badge.innerText()).trim();
    const n = Number(text);
    return Number.isFinite(n) ? n : 0;
  }

  // ── Bulk actions ───────────────────────────────────────────────────────

  /**
   * Click Approve and assert the `approve-multiple` POST resolves 2xx. Returns
   * the response so the caller can assert on the body if needed.
   */
  async approveSelected() {
    const [resp] = await Promise.all([
      this.page.waitForResponse(
        (r) =>
          r.url().includes(STATEMENT_ENDPOINTS.approveMultiple) && r.request().method() === 'POST'
      ),
      this.approveChip.click(),
    ]);
    expect(resp.ok(), `approve-multiple returned HTTP ${resp.status()}`).toBeTruthy();
    return resp;
  }

  /** Click Wired Status and assert the `update-wired-status` POST resolves 2xx. */
  async updateWiredStatusSelected() {
    const [resp] = await Promise.all([
      this.page.waitForResponse(
        (r) =>
          r.url().includes(STATEMENT_ENDPOINTS.updateWiredStatus) && r.request().method() === 'POST'
      ),
      this.wiredStatusChip.click(),
    ]);
    expect(resp.ok(), `update-wired-status returned HTTP ${resp.status()}`).toBeTruthy();
    return resp;
  }

  // ── Filters ────────────────────────────────────────────────────────────

  private get filterPortal(): Locator {
    return this.page.locator('[data-filter-portal="true"]');
  }

  async openFilter() {
    await this.filterTrigger.click();
    await expect(this.page.getByRole('button', { name: /^apply$/i })).toBeVisible();
  }

  /** The (single) draft rule row inside the popover. */
  private ruleRow(index = 0): Locator {
    // Each rule row is the grid `div.grid-cols-[1fr_1fr_40px]`; target by the
    // trailing remove button to anchor, then walk to the row container.
    return this.page
      .locator('button[aria-label="Remove filter"]')
      .nth(index)
      .locator('xpath=ancestor::div[contains(@class,"grid")][1]');
  }

  /** Choose which attribute the rule filters on, by its visible field label. */
  async setRuleField(fieldLabel: RegExp, index = 0) {
    const row = this.ruleRow(index);
    const fieldTrigger = row.locator(':scope > div').first().getByRole('button');
    await fieldTrigger.click();
    await this.filterPortal.getByRole('button', { name: fieldLabel }).first().click();
  }

  private valueCell(index = 0): Locator {
    return this.ruleRow(index).locator(':scope > div').nth(1);
  }

  async setRuleText(value: string, index = 0) {
    await this.valueCell(index).locator('input').fill(value);
  }

  async setRuleSelect(optionLabel: RegExp, index = 0) {
    await this.valueCell(index).getByRole('button').click();
    await this.filterPortal.getByRole('button', { name: optionLabel }).first().click();
  }

  async setRuleMultiSelect(optionLabels: RegExp[], index = 0) {
    const trigger = this.valueCell(index).getByRole('button');
    await trigger.click();
    for (const label of optionLabels) {
      await this.filterPortal.locator('label').filter({ hasText: label }).first().click();
    }
    // The MultiSelect menu closes on a trigger re-click (it has no Escape
    // handler); the value is already committed on each toggle.
    await trigger.click();
  }

  /**
   * Drive the absolute-range tab of the DateRange control: fill the two native
   * `<input type="date">` fields (YYYY-MM-DD) and click the popover's inner
   * Apply. Time defaults (00:00:00 → 23:59:59) are left as-is.
   */
  async setRuleDateRange(fromYmd: string, toYmd: string, index = 0) {
    await this.valueCell(index).getByRole('button').click();
    const dateInputs = this.filterPortal.locator('input[type="date"]');
    await dateInputs.nth(0).fill(fromYmd);
    await dateInputs.nth(1).fill(toYmd);
    await this.filterPortal.getByRole('button', { name: /^apply$/i }).click();
  }

  /** Apply the draft filter and wait for the table to re-fetch + settle. */
  async applyFilter() {
    await this.page.getByRole('button', { name: /^apply$/i }).click();
    await expect(this.skeletonRows).toHaveCount(0, { timeout: 30_000 });
    await this.waitForInitialLoad();
  }

  /**
   * Reset applied filters by reloading the page. The filter slice is not
   * persisted, so a full navigation clears applied rules while the persisted
   * auth keeps the session — cheaper and more reliable than removing rules
   * through the popover one by one. Use this between filter cases.
   */
  async resetFiltersViaReload() {
    await this.goto();
  }
}
