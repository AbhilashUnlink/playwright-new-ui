// E2E: Login flow smoke tests.
//
// Coverage:
//   1. The login page renders with username + password + submit.
//   2. Submitting valid credentials redirects away from /login.
//   3. Submitting invalid credentials keeps the user on /login and surfaces
//      an error message (when the app exposes one via [data-testid="login-error"]
//      or role="alert").
//
// Credentials come from playwright/.env (TEST_USERNAME / TEST_PASSWORD) — see
// playwright/fixtures/test-config.ts. Tests are skipped when credentials are
// missing so a `npx playwright test` run on a fresh checkout doesn't fail
// noisily before the env file is set up.
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/auth/LoginPage';
import { TEST_CONFIG } from '../../fixtures/test-config';

// Skip the suite when credentials are not configured. Avoids a noisy
// `npx playwright test` failure on a fresh checkout before .env is set up.
const HAS_CREDS = !!TEST_CONFIG.credentials.username && !!TEST_CONFIG.credentials.password;

test.describe('Login', () => {
  test.skip(!HAS_CREDS, 'TEST_USERNAME / TEST_PASSWORD env vars not set');

  test('renders the login form', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await expect(loginPage.username).toBeVisible();
    await expect(loginPage.password).toBeVisible();
    await expect(loginPage.submit).toBeVisible();
  });

  test('valid credentials redirect away from /login', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.login(TEST_CONFIG.credentials.username, TEST_CONFIG.credentials.password);

    // login() already awaits a URL change away from /login — assert the
    // post-condition explicitly so the failure message is unambiguous.
    await expect(page).not.toHaveURL(new RegExp(TEST_CONFIG.routes.login));
  });

  test('invalid credentials keep the user on /login', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    // Don't use loginPage.login() — its internal waitForURL would time out on
    // a failed submit. Drive the form directly so we can assert no navigation.
    await loginPage.username.fill('not-a-real-user@example.invalid');
    await loginPage.password.fill('definitely-wrong-password');
    await loginPage.submit.click();

    await expect(page).toHaveURL(new RegExp(TEST_CONFIG.routes.login));

    // Error surfacing varies — only assert if the locator resolves quickly.
    // We do this rather than expect.toBeVisible so the test passes when the
    // app shows the error via toast (no DOM element matched by our locator).
    const errorVisible = await loginPage.errorMessage
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    if (errorVisible) {
      await expect(loginPage.errorMessage).toContainText(/invalid|incorrect|wrong|failed|error/i);
    }
  });
});
