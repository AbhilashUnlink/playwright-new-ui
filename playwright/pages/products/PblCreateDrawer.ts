import { expect, type Locator, type Page } from '@playwright/test';
import type { DateConfig, PblItemConfig } from '../../fixtures/products/types';
import { log } from '../../utils/logger';

/**
 * POM for the Create New Link drawer (`drawerRegistry: paybylink-create`).
 *
 * Surface layout — three views the helper drives:
 *   1. Cart view (empty)   → centered "Add New Item" CTA.
 *   2. Cart view (populated) → "+ Add new item" in the strip + cart table +
 *                              "Proceed to Link Management" button.
 *   3. Link Management view → Expiry Date picker + Link Name input +
 *                             Generate Link button.
 *
 * The Add Item drawer is a secondary right-anchored drawer rendered to the
 * left of the create drawer (`AddItemPanel.tsx`, `rightOffset={935}`). The
 * helper closes it implicitly via the "Add to Cart" submit.
 */
export class PblCreateDrawer {
  readonly page: Page;
  readonly addNewItemButton: Locator;
  readonly proceedToLinkManagement: Locator;
  readonly linkManagementTab: Locator;
  readonly expiryInput: Locator;
  readonly linkNameInput: Locator;
  readonly generateLinkButton: Locator;
  readonly addToCartButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.addNewItemButton = page.getByRole('button', { name: /add\s*new\s*item/i }).first();
    this.proceedToLinkManagement = page
      .getByRole('button', { name: /proceed\s*to\s*link\s*management/i })
      .first();
    this.linkManagementTab = page.getByRole('button', { name: /^link\s*management$/i }).first();
    // DasDatePicker wraps react-datepicker, which renders a real `<input>`
    // element (role=textbox) with the `placeholderText` exposed as the
    // accessible name. The calendar opens in a body-level portal
    // (`#das-datepicker-portal`) on focus.
    this.expiryInput = page.getByRole('textbox', { name: /select\s*date/i }).first();
    // LinkManagementView.tsx renders the link-name `<input>` with the
    // "Optional" placeholder from `paybylink_form.optional` (the PBL
    // namespace's `optional` resolves to "Optional" — no parens; that's the
    // `drawer.optional` key from the refund flow). Scoped via the Link Name
    // label so we never collide with any other "Optional" input.
    this.linkNameInput = page
      .locator('label', { hasText: /^Link\s*Name$/i })
      .locator('..')
      .locator('input[placeholder="Optional"]')
      .first();
    this.generateLinkButton = page.getByRole('button', { name: /^generate\s*link$/i }).first();
    this.addToCartButton = page.getByRole('button', { name: /^add\s*to\s*cart$/i }).first();
  }

  /**
   * Wait until the drawer is mounted. The header reads "Create New Link"
   * (`paybylink_form.title`) before the link is generated.
   */
  async waitForReady() {
    const title = this.page.getByText(/create\s*new\s*link/i).first();
    await expect(title).toBeVisible({ timeout: 15_000 });
  }

  /** Open the Add Item panel and submit one form. Form fields are targeted
   *  by stable id (`#productName`, `#quantity`, `#currency`, `#price`) —
   *  das-form's InputField/SelectField set `id={field.name}`, so we don't
   *  depend on the visible label text (which the schema may localise to
   *  "Name" / "Unit Price" etc.). */
  async addItem(item: PblItemConfig) {
    log.info('PBL — adding cart item', { name: item.productName });
    await this.addNewItemButton.click();

    // Wait for the secondary panel — its submit button is the unique marker.
    await expect(this.addToCartButton).toBeVisible({ timeout: 10_000 });

    // Product name — text input.
    await this.page.locator('#productName').fill(item.productName);

    // Quantity — number input. Clear first because the schema prefills "1",
    // and `fill` over an existing value with a `min: 1` rule is fine, but
    // an explicit clear keeps the helper deterministic when the JSON drives
    // a multi-digit value.
    await this.page.locator('#quantity').fill(item.quantity);

    // Currency — Select trigger; menu renders <button> options inside a
    // `data-filter-portal` div (see Select.tsx).
    if (item.currency) {
      await this.page.locator('#currency').click();
      const portal = this.page.locator('[data-filter-portal="true"]').last();
      await portal
        .getByRole('button', { name: new RegExp(`^${escapeRegExp(item.currency)}$`, 'i') })
        .first()
        .click();
    }

    // Unit price — number input (suffix is purely decorative).
    await this.page.locator('#price').fill(item.price);

    // Require-image checkbox is intentionally NOT clicked unless the JSON
    // opts in. Default cart-item flow skips it.
    if (item.requireImage) {
      await this.page
        .getByLabel(/require\s*image\s*at\s*checkout/i)
        .first()
        .check();
    }

    await this.addToCartButton.click();
    // AddItemPanel's onAdd closes the panel synchronously; wait for the
    // submit to detach the form so the cart view re-renders.
    await expect(this.addToCartButton).toBeHidden({ timeout: 10_000 });
  }

  /** Drive the entire cart-loading step from a config array. */
  async addItems(items: PblItemConfig[]) {
    for (const item of items) {
      await this.addItem(item);
    }
  }

  /** Click the inline "Proceed to Link Management" button under the cart, or
   *  fall back to the tab header if the inline button isn't visible (edit
   *  mode skips the cart view). */
  async proceedToLinkManagementView() {
    if (await this.proceedToLinkManagement.isVisible().catch(() => false)) {
      await this.proceedToLinkManagement.click();
    } else {
      await this.linkManagementTab.click();
    }
    // Generate Link is unique to the Link Management view (the cart view
    // doesn't render it), so it's a sufficient marker we landed there. The
    // expiry textbox sits alongside it on the same view; asserting both via
    // `.or()` would trip strict mode the moment both render.
    await expect(this.generateLinkButton).toBeVisible({ timeout: 10_000 });
  }

  /** Type into the optional Link Name field. Skips when `name` is empty. */
  async setLinkName(name: string | undefined) {
    if (!name) return;
    await this.linkNameInput.fill(name);
  }

  /**
   * Set the expiry date. The DasDatePicker pre-fills with today, which
   * `minDate={new Date()}` accepts — so when the JSON doesn't specify an
   * `expiryDate` (or sets it to `"today"`), this is a no-op. When a
   * `yearsOffset` is given, the helper focuses the textbox to open the
   * calendar (rendered in a body-level portal at `#das-datepicker-portal`),
   * advances `yearsOffset * 12` months, then clicks today's day-of-month
   * on the target month.
   */
  async setExpiry(expiry: DateConfig | undefined) {
    if (!expiry || expiry === 'today' || expiry.yearsOffset === 0) return;
    const yearsOffset = expiry.yearsOffset;

    // Focus opens the calendar — react-datepicker uses focus, not click,
    // as the open trigger.
    await this.expiryInput.click();

    // Calendar is portal'd to `#das-datepicker-portal`.
    const calendar = this.page.locator('#das-datepicker-portal .react-datepicker').first();
    await expect(calendar).toBeVisible({ timeout: 5_000 });

    const nextMonth = calendar.locator('button[aria-label*="Next Month"]').first();
    for (let i = 0; i < yearsOffset * 12; i += 1) {
      await nextMonth.click();
    }

    // Pick today's day-of-month on the target month — guaranteed to exist
    // (every month has 1..28). Use the in-month day cell to avoid the
    // greyed-out leading/trailing days from adjacent months.
    const todayDom = new Date().getDate();
    const dayCell = calendar
      .locator('.react-datepicker__day:not(.react-datepicker__day--outside-month)')
      .filter({ hasText: new RegExp(`^${todayDom}$`) })
      .first();
    await dayCell.click();
  }

  async clickGenerateLink() {
    await this.generateLinkButton.click();
  }

  /**
   * Click Generate Link and return the new link ID, read from the create
   * mutation's API response.
   *
   * The create call is `POST paybylink/add/DASMID/<dasmid>`, which is a
   * distinct path from the list refetch fired by `onMutationSuccess`
   * (`paybylink/order/list/DASMID/...`). Matching `/paybylink/add/` (POST
   * only) therefore resolves on the mutation alone and never collides with
   * the refetch. The response body is the `{ data: <record> }` envelope
   * unwrapped by `usePblMutation`. The public link is keyed on the order's
   * `ProductID` (the same id the list surfaces as `Link`, stable across
   * regenerate), so we read `data.ProductID` — matching what the drawer renders
   * via `getPblPublicUrl(linkResult.ProductID)` in PostGenerationBlock — with
   * an `ID` fallback for safety.
   *
   * We still wait for that rendered URL afterwards so callers can rely on the
   * post-generation block being on screen, but the returned ID comes from the
   * response — the authoritative source the moment the server issues it.
   */
  async generateLinkAndAwaitId(): Promise<string> {
    const responsePromise = this.page.waitForResponse(
      (res) =>
        /\/paybylink\/add\/DASMID\//i.test(res.url()) &&
        res.request().method() === 'POST' &&
        res.ok(),
      { timeout: 30_000 }
    );

    await this.generateLinkButton.click();

    const response = await responsePromise;
    const body = (await response.json().catch(() => null)) as {
      ID?: string;
      ProductID?: string;
      data?: { ID?: string; ProductID?: string };
    } | null;
    const newId = body?.data?.ProductID ?? body?.ProductID ?? body?.data?.ID ?? body?.ID ?? '';
    expect(newId, 'create response should carry a non-empty link ID').toBeTruthy();

    // Confirm the drawer actually rendered the post-generation URL for this
    // ID so callers get the same guarantee the DOM-based wait used to give.
    const urlText = this.page.getByText(new RegExp(`/paybylink/${escapeRegExp(newId)}\\b`)).first();
    await expect(urlText, 'post-generation payment link should render').toBeVisible({
      timeout: 30_000,
    });

    log.info('PBL drawer — link generated', { newId });
    return newId;
  }

  /**
   * After Generate Link succeeds, `PostGenerationBlock` renders below the
   * Regenerate / Deactivate row with:
   *   • a "QR Code" heading + View / Share / Download cards,
   *   • a "Payment Link" heading,
   *   • the public `/paybylink/<id>` URL.
   *
   * The block returns `null` when the server marks the link EXPIRED /
   * INACTIVE — so seeing all three of these elements is a strong signal
   * the link actually generated and rendered. When `expectedId` is passed
   * (typically the value returned by `generateLinkAndAwaitId`), the URL
   * assertion is tightened to match `/paybylink/<that exact id>`.
   */
  async assertPostGenerationVisible(expectedId?: string) {
    await expect(this.page.getByRole('heading', { name: /^qr\s*code$/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(this.page.getByRole('heading', { name: /^payment\s*link$/i }).first()).toBeVisible(
      { timeout: 15_000 }
    );

    const urlPattern = expectedId
      ? new RegExp(`/paybylink/${escapeRegExp(expectedId)}\\b`)
      : /\/paybylink\/[0-9a-f-]{16,}/i;
    await expect(this.page.getByText(urlPattern).first()).toBeVisible({ timeout: 15_000 });
  }

  // --- helpers ---------------------------------------------------------------

  private async fillLabeledInput(label: RegExp, value: string) {
    // `<label>` -> sibling `<input>` lookup. DasForm renders inputs with
    // `htmlFor` attached to the input id, so getByLabel works against the
    // visible label text directly.
    const input = this.page.getByLabel(label).first();
    await input.fill(value);
  }

  private async pickLabeledSelect(label: RegExp, optionLabel: string) {
    // Selects render as `<button>` triggers. Open by clicking the trigger
    // immediately after a `<label>` whose text matches.
    const trigger = this.page
      .locator('label', { hasText: label })
      .locator('..')
      .locator('button')
      .first();
    await trigger.click();

    const option = this.page
      .locator('[data-filter-portal="true"]')
      .getByRole('button', { name: new RegExp(`^${escapeRegExp(optionLabel)}$`, 'i') })
      .first();
    await option.click();
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
