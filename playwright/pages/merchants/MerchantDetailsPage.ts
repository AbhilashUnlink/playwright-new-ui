import { expect, type Locator, type Page } from '@playwright/test';

export type MerchantTabId =
  | 'merchant-information'
  | 'product-information'
  | 'user-management'
  | 'merchant-settings'
  | 'merchant-catalogue';

export const TAB_LABELS: Record<MerchantTabId, RegExp> = {
  'merchant-information': /^merchant\s*information$/i,
  'product-information': /^product\s*information$/i,
  'user-management': /^user\s*management$/i,
  'merchant-settings': /^merchant\s*settings$/i,
  'merchant-catalogue': /^merchant\s*catalogue$/i,
};

export type MerchantSettingId = 'ip-whitelist' | 'webhook-url-configuration';

export const SETTING_LABELS: Record<MerchantSettingId, RegExp> = {
  'ip-whitelist': /^ip\s*whitelisting$/i,
  'webhook-url-configuration': /^webhook\s*url\s*configuration$/i,
};

export type MerchantCatalogueId = 'categories' | 'products';

export const CATALOGUE_LABELS: Record<MerchantCatalogueId, RegExp> = {
  categories: /^categories$/i,
  products: /^products$/i,
};

export type InfoFilterPill = 'all' | 'business-details' | 'contact-details';

export const INFO_PILL_LABELS: Record<InfoFilterPill, RegExp> = {
  all: /^all$/i,
  'business-details': /^business\s*details$/i,
  'contact-details': /^contact\s*details$/i,
};

/**
 * POM for `/accounts/merchants/merchant-details/:id`.
 *
 * Surfaces every primary surface on the page:
 *   - the back button + breadcrumb header,
 *   - the LIVE API KEYS popover trigger,
 *   - the five tabs (two of which are dropdowns: settings + catalogue),
 *   - the merchant-information filter pills (All / Business / Contact),
 *   - the in-tab section headings used to assert the active surface rendered.
 *
 * Tab state is encoded as URL query params (`?tab=&setting=&catalogue=`),
 * so each interaction below also asserts the resulting URL.
 */
export class MerchantDetailsPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly backButton: Locator;
  readonly breadcrumbMerchants: Locator;
  readonly liveApiKeysButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.locator('h1').first();
    this.backButton = page.getByRole('button', { name: /^back$/i }).first();
    this.breadcrumbMerchants = page.getByRole('link', { name: /^merchants$/i }).first();
    this.liveApiKeysButton = page.getByRole('button', { name: /^live\s*api\s*keys$/i }).first();
  }

  async waitForReady(merchantId?: string): Promise<void> {
    await expect(this.page).toHaveURL(/\/accounts\/merchants\/merchant-details\/[^/]+/);
    if (merchantId) {
      await expect(this.page).toHaveURL(new RegExp(`/merchant-details/${merchantId}(?:[/?]|$)`));
    }
    // Initial spinner from `useMerchantDetails` — let it resolve before
    // any tab interactions, otherwise tab clicks race with the loader.
    const spinner = this.page.locator('svg.animate-spin').first();
    await expect(spinner).toHaveCount(0, { timeout: 30_000 });
    await expect(this.heading).toBeVisible();
  }

  // ---- header ---------------------------------------------------------

  /**
   * The header pill text (e.g. "Total Products 12"). Returns the trimmed
   * value beside the label or null if the pill is not currently rendered
   * (the pill is contextual — only some tabs surface one).
   */
  async getStatsPillValue(label: RegExp): Promise<string | null> {
    const pill = this.page
      .locator('div')
      .filter({ has: this.page.getByText(label) })
      .first();
    if ((await pill.count()) === 0) return null;
    const text = (await pill.innerText()).trim();
    return text;
  }

  // ---- tabs -----------------------------------------------------------

  private tabButton(id: MerchantTabId): Locator {
    return this.page.getByRole('button', { name: TAB_LABELS[id] }).first();
  }

  async switchTab(id: MerchantTabId): Promise<void> {
    const btn = this.tabButton(id);
    await expect(btn).toBeVisible();
    await btn.click();
    if (id === 'merchant-information') {
      await expect(this.page).not.toHaveURL(/[?&]tab=/);
    } else {
      await expect(this.page).toHaveURL(new RegExp(`[?&]tab=${id}(?:&|$)`));
    }
  }

  /**
   * Open one of the dropdown tabs (settings / catalogue) AND pick a
   * sub-item from its menu. Both URL keys are asserted.
   */
  async openSettings(setting: MerchantSettingId): Promise<void> {
    await this.tabButton('merchant-settings').click();
    const item = this.page.getByRole('menuitem', { name: SETTING_LABELS[setting] }).first();
    await expect(item).toBeVisible({ timeout: 5_000 });
    await item.click();
    await expect(this.page).toHaveURL(/[?&]tab=merchant-settings(?:&|$)/);
    await expect(this.page).toHaveURL(new RegExp(`[?&]setting=${setting}(?:&|$)`));
  }

  async openCatalogue(item: MerchantCatalogueId): Promise<void> {
    await this.tabButton('merchant-catalogue').click();
    const menuItem = this.page.getByRole('menuitem', { name: CATALOGUE_LABELS[item] }).first();
    await expect(menuItem).toBeVisible({ timeout: 5_000 });
    await menuItem.click();
    await expect(this.page).toHaveURL(/[?&]tab=merchant-catalogue(?:&|$)/);
    await expect(this.page).toHaveURL(new RegExp(`[?&]catalogue=${item}(?:&|$)`));
  }

  // ---- merchant-information surface ----------------------------------

  async assertMerchantInformationVisible(): Promise<void> {
    // The pills + at least one section heading are the page-level signal
    // that the tab actually mounted (vs. a stuck spinner).
    await expect(this.page.getByRole('button', { name: INFO_PILL_LABELS.all })).toBeVisible();
    await expect(
      this.page.getByRole('heading', { name: /business\s*details/i }).first()
    ).toBeVisible();
  }

  async selectInfoPill(pill: InfoFilterPill): Promise<void> {
    const btn = this.page.getByRole('button', { name: INFO_PILL_LABELS[pill] }).first();
    await btn.click();
    await this.assertInfoPillSections(pill);
  }

  /**
   * Each pill controls which section(s) render (split / single layout).
   * The page swaps DOM rather than just toggling visibility, so we assert
   * the section headings directly.
   */
  async assertInfoPillSections(pill: InfoFilterPill): Promise<void> {
    const business = this.page.getByRole('heading', { name: /business\s*details/i }).first();
    const contact = this.page.getByRole('heading', { name: /contact\s*details/i }).first();
    if (pill === 'all') {
      await expect(business).toBeVisible();
      await expect(contact).toBeVisible();
      return;
    }
    if (pill === 'business-details') {
      await expect(business).toBeVisible();
      await expect(contact).toHaveCount(0);
      return;
    }
    await expect(contact).toBeVisible();
    await expect(business).toHaveCount(0);
  }

  // ---- product / user / settings / catalogue surfaces ----------------

  async assertProductInformationVisible(): Promise<void> {
    // Product Information renders a content panel — assert the page is no
    // longer showing the spinner and the URL is the right tab.
    await expect(this.page).toHaveURL(/[?&]tab=product-information(?:&|$)/);
    const spinner = this.page.locator('svg.animate-spin').first();
    await expect(spinner).toHaveCount(0, { timeout: 15_000 });
  }

  async assertUserManagementVisible(): Promise<void> {
    await expect(this.page).toHaveURL(/[?&]tab=user-management(?:&|$)/);
    // Add New User button is the User Management surface's signature CTA —
    // it only appears when the user-management tab is mounted.
    await expect(this.page.getByRole('button', { name: /add\s*new\s*user/i })).toBeVisible();
  }

  async assertSettingVisible(setting: MerchantSettingId): Promise<void> {
    if (setting === 'ip-whitelist') {
      await expect(
        this.page.getByRole('heading', { name: /ip\s*whitelisting\s*configuration/i }).first()
      ).toBeVisible();
      await expect(this.page.getByRole('button', { name: /add\s*ip\s*address/i })).toBeVisible();
      return;
    }
    await expect(
      this.page.getByRole('heading', { name: /webhook\s*url\s*configuration/i }).first()
    ).toBeVisible();
    // The Add Webhook URL button is only present when no webhook exists — no
    // hard assertion on it; the section header is enough to confirm mount.
  }

  async assertCatalogueVisible(item: MerchantCatalogueId): Promise<void> {
    if (item === 'categories') {
      await expect(this.page.getByRole('heading', { name: /categories/i }).first()).toBeVisible();
      return;
    }
    await expect(this.page.getByRole('heading', { name: /products/i }).first()).toBeVisible();
  }

  // ---- navigation -----------------------------------------------------

  async openLiveApiKeys(): Promise<void> {
    await this.liveApiKeysButton.click();
    // Popover renders a heading "Live API Keys" — assert it became visible.
    await expect(
      this.page.getByRole('heading', { name: /live\s*api\s*keys/i }).first()
    ).toBeVisible({ timeout: 5_000 });
  }

  async backToList(): Promise<void> {
    await this.backButton.click();
    await this.page.waitForURL(/\/accounts\/merchants(?:[/?#]|$)/, { timeout: 15_000 });
  }
}
