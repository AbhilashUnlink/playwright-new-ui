import { expect, type Locator, type Page } from '@playwright/test';
import { TEST_CONFIG } from '../../fixtures/test-config';
import { log } from '../../utils/logger';

/**
 * POM for `/products` — the global product list page.
 *
 * The page has no dedicated `data-testid` hooks today, so locators lean on
 * structural patterns:
 *   - the filter button is the `PageBar.FilterButton` (`Filters` text),
 *   - the popover is the right-aligned panel whose header reads
 *     "Advanced Filters",
 *   - each filter rule is a `grid-cols-[1fr_1fr_40px]` row with a Field
 *     button + Value button + Remove icon button.
 *
 * `applyFilters` adds rules sequentially. The product list's filter popover
 * already renders one empty rule on open; the helper fills it first, then
 * clicks "Add New" for any additional rules.
 */
export class ProductsListPage {
  readonly page: Page;
  readonly pageTitle: Locator;
  readonly filterButton: Locator;
  readonly filterPopover: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pageTitle = page.getByRole('heading', { name: /^products$/i }).first();
    this.filterButton = page.getByRole('button', { name: /^filters/i }).first();
    // The popover Content is the absolutely-positioned panel that renders
    // "Advanced Filters" in its header.
    this.filterPopover = page.locator(':text("Advanced Filters")').locator('..').locator('..');
  }

  async goto() {
    await this.page.goto(TEST_CONFIG.routes.products);
    await this.waitForReady();
  }

  async waitForReady() {
    await expect(this.pageTitle).toBeVisible({ timeout: 30_000 });
    // Wait for either at least one product row or the empty state.
    await expect(async () => {
      const rows = await this.page.locator('table tbody tr').count();
      if (rows > 0) return;
      await expect(this.page.getByText(/no\s*data|empty/i).first()).toBeVisible();
    }).toPass({ timeout: 30_000 });
  }

  /**
   * Apply Merchant Account + Product Type filters via the popover.
   * Each rule:
   *   1. Click the field-picker button → pick the field label.
   *   2. Click the value control → pick the visible option label.
   * Then click Apply.
   */
  async applyFilters({
    merchantName,
    productType,
  }: {
    merchantName?: string;
    productType?: string;
  }) {
    log.info('Products list — applying filters', { merchantName, productType });
    await this.filterButton.click();

    // The popover renders an "Advanced Filters" header — wait for it.
    const header = this.page.getByText('Advanced Filters').first();
    await expect(header).toBeVisible({ timeout: 10_000 });

    // The popover always renders at least one empty rule on first open. Each
    // additional rule needs an explicit "Add New" click.
    let ruleIndex = 0;
    if (merchantName) {
      await this.setRule(ruleIndex, /^Merchant\s*Account$/i, merchantName, 'multi');
      ruleIndex += 1;
    }
    if (productType) {
      if (ruleIndex > 0) {
        await this.page.getByRole('button', { name: /^Add New$/i }).click();
      }
      await this.setRule(ruleIndex, /^Product\s*Type$/i, productType, 'multi');
    }

    await this.page.getByRole('button', { name: /^Apply$/i }).click();
    // Popover collapses on Apply when canApply is true.
    await expect(header).toBeHidden({ timeout: 5_000 });
  }

  /**
   * Drive a single rule row. `valueMode` controls whether the value control
   * is a single-select (`single`) or a multi-select chip-picker (`multi`).
   *
   * The Select used for the field picker renders options as `<button>`s; the
   * MultiSelect used for value pickers (Merchant Account, Product Type, etc.)
   * renders each option as `<label><input type="checkbox"> …</label>` — which
   * is why the value picker is driven by typing into the menu's built-in
   * search box and then clicking the matching checkbox.
   *
   * Using the search box also smooths over the gatewayConfig-driven option
   * lists (Merchant Account, DAS MID, Acquirer) which load asynchronously
   * after login; `expect(option).toBeVisible({ timeout: 30_000 })` waits
   * deterministically for the option to appear instead of sleeping.
   */
  private async setRule(
    rowIndex: number,
    fieldLabel: RegExp,
    valueLabel: string,
    valueMode: 'single' | 'multi'
  ) {
    // Rule rows are the `grid-cols-[1fr_1fr_40px]` siblings inside the
    // popover panel (the popover is rendered into the document, not via
    // portal, so a global locator is reliable as long as we filter by its
    // structural Tailwind class).
    const ruleRow = this.page
      .locator('div.grid.grid-cols-\\[1fr_1fr_40px\\].items-center')
      .nth(rowIndex);

    // 1) Field picker (1st cell) — Select renders <button> options.
    await ruleRow.locator('button').first().click();
    await this.page
      .locator('[data-filter-portal="true"]')
      .getByRole('button', { name: fieldLabel })
      .first()
      .click();

    // 2) Value picker (2nd cell). `.last()` because each open menu mounts its
    // own portal — the most recently opened one is the active one (the field
    // picker's portal may still be in the DOM briefly during close animation).
    await ruleRow.locator('button').nth(1).click();
    const portal = this.page.locator('[data-filter-portal="true"]').last();

    if (valueMode === 'multi') {
      // MultiSelect — narrow via the built-in search input + click the
      // matching checkbox. The search input also gives Playwright's auto-wait
      // something deterministic to assert against while the async option list
      // populates.
      const search = portal.getByPlaceholder('Search…');
      await search.fill(valueLabel);

      const option = portal.getByRole('checkbox', {
        name: new RegExp(`^${escapeRegExp(valueLabel)}$`, 'i'),
      });
      await expect(option).toBeVisible({ timeout: 30_000 });
      await option.check();

      // Multi-select stays open until an outside click — the popover header
      // is safe (doesn't dismiss the outer popover).
      await this.page.getByText('Advanced Filters').first().click();
    } else {
      // Select — options are <button>.
      await portal
        .getByRole('button', { name: new RegExp(`^${escapeRegExp(valueLabel)}$`, 'i') })
        .first()
        .click();
    }
  }

  /**
   * Click the first filtered product row's name link and wait for the
   * per-DASMID product page to load. `urlPattern` lets the caller pin the
   * destination (`/products/paybylink/…`, `/products/subscription/…`, etc.)
   * since the name cell routes by the row's product Type.
   *
   * Used when the filter has already narrowed the list to a single product
   * type for a merchant and the exact product name isn't known to the fixture.
   */
  async openFirstProductRow(urlPattern: RegExp) {
    const firstRow = this.page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 15_000 });

    const nameCell = firstRow.locator('td').first();
    const nameLink = nameCell
      .locator('span.cursor-pointer')
      .or(nameCell.locator('span').first())
      .first();
    await nameLink.click();

    await this.page.waitForURL(urlPattern, { timeout: 15_000 });
  }

  /**
   * Find the product row by visible product-name text and click the name
   * link (the first cell's `link-copy` cell — same primary trigger the page
   * uses to navigate to the per-DASMID PBL page).
   */
  async openProductByName(productName: string) {
    const row = this.page
      .locator('table tbody tr')
      .filter({ hasText: new RegExp(escapeRegExp(productName), 'i') })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    // The first cell renders the product name as a CopyCell with the primary
    // span using cursor-pointer (clicking the row body opens the drawer; only
    // the primary text in cell #1 navigates).
    const nameCell = row.locator('td').first();
    const nameLink = nameCell
      .locator('span.cursor-pointer')
      .or(nameCell.locator('span').first())
      .first();
    await nameLink.click();

    // Page navigates to /products/paybylink/<dasmid>.
    await this.page.waitForURL(/\/products\/paybylink\/[^/]+/, { timeout: 15_000 });
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
