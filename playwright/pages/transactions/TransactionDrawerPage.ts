import { expect, type Locator, type Page } from '@playwright/test';
import { ACTION_LABELS, type ActionButton } from '../../fixtures/test-config';
import type { ActionVisibility } from './TransactionDetailsPage';

/**
 * POM for the global drawer rendered by `DrawerManager` and portaled to <body>.
 * The drawer header (DrawerTransactionHeader) carries the action buttons:
 *   Details / Refund / Capture / Void / Dispute   (left tab row)
 *   Edit Status                                    (right side)
 */
export class TransactionDrawerPage {
  readonly page: Page;
  readonly root: Locator;
  readonly closeButton: Locator;
  readonly refIdText: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId('transaction-drawer').or(page.locator('[role="dialog"]')).first();
    this.closeButton = this.root.getByRole('button', { name: /close/i }).first();
    this.refIdText = this.root.locator('span', { hasText: /^[0-9a-f-]{8,}$/i }).first();
  }

  async waitForReady() {
    await expect(this.root).toBeVisible({ timeout: 15_000 });
    const spinner = this.root.locator('svg.animate-spin').first();
    await expect(spinner).toHaveCount(0, { timeout: 30_000 });
    await expect(this.page).toHaveURL(/[?&]drawer=/);
  }

  private button(action: ActionButton): Locator {
    const testId = this.root.getByTestId(`drawer-action-${action}`);
    const byRole = this.root.getByRole('button', { name: ACTION_LABELS[action] });
    return testId.or(byRole).first();
  }

  async getActionVisibility(): Promise<ActionVisibility> {
    return {
      refund: await this.isActionVisible('refund'),
      capture: await this.isActionVisible('capture'),
      void: await this.isActionVisible('void'),
      dispute: await this.isActionVisible('dispute'),
      editStatus: await this.isActionVisible('editStatus'),
    };
  }

  async isActionVisible(action: ActionButton): Promise<boolean> {
    const btn = this.button(action);
    if ((await btn.count()) === 0) return false;
    return btn.isVisible();
  }

  async isActionEnabled(action: ActionButton): Promise<boolean> {
    const btn = this.button(action);
    if ((await btn.count()) === 0) return false;
    return btn.isEnabled();
  }

  async close() {
    if ((await this.closeButton.count()) > 0 && (await this.closeButton.isVisible())) {
      await this.closeButton.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
    await expect(this.root).toBeHidden({ timeout: 10_000 });
    await expect(this.page).not.toHaveURL(/[?&]drawer=/, { timeout: 10_000 });
  }
}
