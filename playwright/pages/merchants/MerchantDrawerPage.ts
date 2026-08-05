import { expect, type Locator, type Page } from '@playwright/test';

/**
 * POM for the merchant drawer (DrawerManager → MerchantDetailsDrawer),
 * portaled to <body> via DasDrawer when the URL contains
 * `?drawer=merchant&id=<merchantId>`.
 *
 * The drawer renders:
 *   - a header label "MERCHANT" with the legal name
 *   - a "Live API Keys" toggle
 *   - three collapsible sections: Business Details, Contact Details,
 *     Product Information (with a count badge + external-link icon to the
 *     full merchant details page).
 */
export class MerchantDrawerPage {
  readonly page: Page;
  readonly root: Locator;
  readonly closeButton: Locator;
  readonly liveApiKeysToggle: Locator;
  readonly openInPageButton: Locator;
  readonly businessSection: Locator;
  readonly contactSection: Locator;
  readonly productSection: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId('merchant-drawer').or(page.locator('[role="dialog"]')).first();
    this.closeButton = this.root.getByRole('button', { name: /close/i }).first();
    this.liveApiKeysToggle = this.root.getByRole('button', { name: /live\s*api\s*keys/i }).first();
    this.openInPageButton = this.root
      .getByRole('button', { name: /open in page|open\s*details/i })
      .first();
    this.businessSection = this.root.getByRole('heading', { name: /business\s*details/i }).first();
    this.contactSection = this.root.getByRole('heading', { name: /contact\s*details/i }).first();
    this.productSection = this.root
      .getByRole('heading', { name: /product\s*information/i })
      .first();
  }

  async waitForReady(): Promise<void> {
    await expect(this.root).toBeVisible({ timeout: 15_000 });
    const spinner = this.root.locator('svg.animate-spin').first();
    await expect(spinner).toHaveCount(0, { timeout: 30_000 });
    await expect(this.page).toHaveURL(/[?&]drawer=/);
  }

  async assertSectionsVisible(): Promise<void> {
    // Drawer should always render the three primary sections, even on a
    // skeleton merchant — assert each independently so failures pinpoint the
    // missing section rather than a generic "drawer empty" message.
    await expect(this.businessSection).toBeVisible();
    await expect(this.contactSection).toBeVisible();
    await expect(this.productSection).toBeVisible();
  }

  async toggleApiKeys(): Promise<void> {
    if ((await this.liveApiKeysToggle.count()) === 0) return;
    await this.liveApiKeysToggle.click();
  }

  async close(): Promise<void> {
    if ((await this.closeButton.count()) > 0 && (await this.closeButton.isVisible())) {
      await this.closeButton.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
    await expect(this.root).toBeHidden({ timeout: 10_000 });
    await expect(this.page).not.toHaveURL(/[?&]drawer=/, { timeout: 10_000 });
  }
}
