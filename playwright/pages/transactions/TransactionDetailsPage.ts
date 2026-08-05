import { expect, type Locator, type Page } from '@playwright/test';
import { ACTION_LABELS, type ActionButton } from '../../fixtures/test-config';

export interface ActionVisibility {
  refund: boolean;
  capture: boolean;
  void: boolean;
  dispute: boolean;
  editStatus: boolean;
}

export class TransactionDetailsPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async waitForReady() {
    await expect(this.page).toHaveURL(/\/transactions\/[^/]+/);
    const spinner = this.page.locator('svg.animate-spin').first();
    await expect(spinner).toHaveCount(0, { timeout: 30_000 });
  }

  private button(action: ActionButton): Locator {
    const testId = this.page.getByTestId(`action-${action}`);
    const byRole = this.page.getByRole('button', { name: ACTION_LABELS[action] });
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
}
