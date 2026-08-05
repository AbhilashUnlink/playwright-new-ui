import { expect, type Locator, type Page } from '@playwright/test';
import { TEST_CONFIG } from '../../fixtures/test-config';

export class LoginPage {
  readonly page: Page;
  readonly username: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.username = page
      .getByTestId('login-username')
      .or(page.getByLabel(/username|email/i))
      .or(page.locator('input[name="username"], input[name="email"], input[type="email"]'))
      .first();
    this.password = page
      .getByTestId('login-password')
      .or(page.getByLabel(/password/i))
      .or(page.locator('input[type="password"]'))
      .first();
    this.submit = page
      .getByTestId('login-submit')
      .or(page.getByRole('button', { name: /sign in|log\s*in|login/i }))
      .first();
    this.errorMessage = page.getByTestId('login-error').or(page.getByRole('alert')).first();
  }

  async goto() {
    await this.page.goto(TEST_CONFIG.routes.login, { waitUntil: 'domcontentloaded' });
    await expect(this.username).toBeVisible();
  }

  async login(username: string, password: string) {
    if (!username || !password) {
      throw new Error('TEST_USERNAME / TEST_PASSWORD env vars must be set');
    }
    await this.username.fill(username);
    await this.password.fill(password);
    await Promise.all([
      this.page.waitForURL((url) => !url.pathname.startsWith(TEST_CONFIG.routes.login), {
        timeout: 30_000,
      }),
      this.submit.click(),
    ]);
  }
}
