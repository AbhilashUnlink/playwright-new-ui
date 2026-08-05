import { expect, type Locator, type Page } from '@playwright/test';

/**
 * POM for `/products/paybylink/:dasmid` — the per-merchant PBL orders list.
 *
 * Two surfaces expose the "Create New Link" CTA depending on whether the
 * merchant already has links:
 *   - empty state: a centered `<Button>` below the empty illustration,
 *   - populated state: a `<Button variant="ghost">` in the strip header.
 *
 * The helper matches on the visible label so either works.
 */
export class PblOrdersPage {
  readonly page: Page;
  readonly pageTitle: Locator;
  readonly createNewLinkButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pageTitle = page.getByRole('heading', { name: /pay\s*by\s*link/i }).first();
    this.createNewLinkButton = page.getByRole('button', { name: /create\s*new\s*link/i }).first();
  }

  async waitForReady() {
    await expect(this.pageTitle).toBeVisible({ timeout: 30_000 });
    await expect(this.createNewLinkButton).toBeVisible({ timeout: 15_000 });
  }

  async openCreateDrawer() {
    await this.createNewLinkButton.click();
    // The PBL create drawer renders via the drawer registry (Redux state) and
    // does NOT mutate the URL like the merchant drawer does. Wait for the
    // drawer's own visible markers — the "Create New Link" header and the
    // empty-cart "Add New Item" CTA — instead of a URL signal.
    await expect(this.page.getByText(/^create\s*new\s*link$/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      this.page.getByRole('button', { name: /^add\s*new\s*item$/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  }
}
