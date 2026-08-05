import { expect, type Locator, type Page } from '@playwright/test';
import { TEST_CONFIG } from '../../fixtures/test-config';

export interface SignUpAccount {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  /** Optional country selection on the public sign-up form. When provided,
   *  `fillAccount` drives the businessLocation `Select`; otherwise the
   *  form's default (JP for both Merchant and Partner) stands. Matched
   *  case-insensitively against the option's visible label (e.g. `"Japan"`,
   *  `"Hong Kong"`). */
  businessLocation?: string;
  /** Optional dial code (`"+81"`). The form auto-syncs this from
   *  `businessLocation`, so most callers can omit it. */
  phoneCode?: string;
}

/**
 * Page object for the public GUEST sign-up wizard:
 *   /choose-account-type  →  /onboarding/sign-up  (account → OTP → password)
 *
 * The three sign-up steps share one URL — the wizard swaps its body — so each
 * step is awaited by a marker element rather than a navigation. On a verified
 * password the app establishes a session and lands on /onboarding.
 *
 * Account-form fields carry no `<label>`, only an `id` equal to the field
 * name, so they're targeted by `#id`. `businessLocation` / `phoneCode` keep
 * their defaults (JP / +81) — the Merchant flow locks the location anyway.
 */
export class GuestSignUpPage {
  readonly page: Page;
  readonly firstName: Locator;
  readonly lastName: Locator;
  readonly phoneNumber: Locator;
  readonly email: Locator;
  readonly password: Locator;
  readonly confirmPassword: Locator;
  readonly agree: Locator;

  constructor(page: Page) {
    this.page = page;
    this.firstName = page.locator('#firstName');
    this.lastName = page.locator('#lastName');
    this.phoneNumber = page.locator('#phoneNumber');
    this.email = page.locator('#email');
    this.password = page.locator('#password');
    this.confirmPassword = page.locator('#confirmPassword');
    this.agree = page.locator('#agree');
  }

  /** Unique per run so the sign-up never hits an "email already registered". */
  static uniqueEmail(): string {
    return `po-e2e-guest-${Date.now()}@${TEST_CONFIG.guestEmailDomain}`;
  }

  /** The single visible `type="submit"` button of the current wizard step. */
  private stepSubmit(): Locator {
    return this.page.locator('button[type="submit"]').first();
  }

  async goto() {
    await this.page.goto(TEST_CONFIG.routes.chooseAccountType, { waitUntil: 'domcontentloaded' });
  }

  /** Land on /login, then take the "Create an Account" link across to
   *  /choose-account-type. Mirrors what a real visitor types in the URL bar:
   *  Sign in → "Create an Account". */
  async gotoFromLogin() {
    await this.page.goto(TEST_CONFIG.routes.login, { waitUntil: 'domcontentloaded' });
    const createAccount = this.page.getByRole('link', { name: /create an account/i }).first();
    await createAccount.waitFor({ state: 'visible', timeout: 15_000 });
    await Promise.all([
      this.page.waitForURL(new RegExp(TEST_CONFIG.routes.chooseAccountType)),
      createAccount.click(),
    ]);
  }

  /** Pick the Merchant card — the whole card is the CTA, it navigates to
   *  /onboarding/sign-up on click. */
  async selectMerchant() {
    await this.page
      .getByRole('button', { name: /merchant/i })
      .first()
      .click();
    await this.page.waitForURL(new RegExp(TEST_CONFIG.routes.signUp));
    await expect(this.firstName).toBeVisible();
  }

  /** Pick the Partner (reseller) card — `/choose-account-type` renders both
   *  the "Register as a Merchant" and "Register as a Partner" tiles as
   *  `<button>`s sharing a layout, so the role+name selector is enough to
   *  disambiguate. Picking it persists `PARTNER` to the signup session and
   *  navigates to `/onboarding/sign-up`, where the same account form is
   *  rendered but the new account is created as a GUESTTHIRDPARTY. */
  async selectPartner() {
    await this.page
      .getByRole('button', { name: /partner/i })
      .first()
      .click();
    await this.page.waitForURL(new RegExp(TEST_CONFIG.routes.signUp));
    await expect(this.firstName).toBeVisible();
  }

  /** Pick an option in the custom `Select` rendered by the das-form runtime.
   *  Same portal anchor as the onboarding wizard's selects
   *  (`[data-filter-portal="true"]`), and the portal carries a `Search…`
   *  input that filters by **label OR value** (case-insensitive substring).
   *  Type the JSON value into that search box and click the first remaining
   *  row — so ISO codes (e.g. `"JP"`) reliably pick the right row even when
   *  the visible label is the translated country name. When the menu has no
   *  search input (small option lists), fall back to a case-insensitive
   *  label-text match so plain labels still work. Best-effort: a miss is
   *  swallowed and the menu dismissed. */
  private async pickSelectOption(id: string, value: string) {
    const trigger = this.page.locator(`#${id}`);
    if (!(await trigger.isVisible().catch(() => false))) return;
    if (await trigger.isDisabled().catch(() => false)) return;
    await trigger.click();
    const portal = this.page.locator('[data-filter-portal="true"]').last();
    const search = portal.locator('input[placeholder="Search…"]');
    if (await search.isVisible().catch(() => false)) {
      await search.fill(value);
      await portal
        .locator('button:not([aria-label="Clear search"])')
        .first()
        .click({ timeout: 5_000 })
        .catch(() => this.page.keyboard.press('Escape').catch(() => {}));
      return;
    }
    await portal
      .locator('button')
      .filter({ hasText: new RegExp(value, 'i') })
      .first()
      .click({ timeout: 5_000 })
      .catch(() => this.page.keyboard.press('Escape').catch(() => {}));
  }

  /** Fill the account step and advance to the OTP step. When the caller
   *  supplies `businessLocation` / `phoneCode`, the corresponding `Select`s
   *  are driven; otherwise the form's defaults (JP / +81) stand. */
  async fillAccount(account: SignUpAccount) {
    await this.firstName.fill(account.firstName);
    await this.lastName.fill(account.lastName);
    if (account.businessLocation) {
      await this.pickSelectOption('businessLocation', account.businessLocation);
    }
    if (account.phoneCode) {
      // Drive phoneCode AFTER businessLocation — the form's auto-sync effect
      // overwrites phoneCode whenever businessLocation changes, so an
      // earlier pick here would be clobbered.
      await this.pickSelectOption('phoneCode', account.phoneCode);
    }
    await this.phoneNumber.fill(account.phone);
    await this.email.fill(account.email);
    await this.stepSubmit().click();
    // OTP step shares the URL — wait for its first digit box.
    await expect(this.page.getByLabel('Digit 1')).toBeVisible({ timeout: 30_000 });
  }

  /** Enter the fixed verification OTP and advance to the password step. */
  async submitOtp(otp: string) {
    for (let i = 0; i < otp.length; i += 1) {
      await this.page.getByLabel(`Digit ${i + 1}`).fill(otp[i]!);
    }
    await this.stepSubmit().click();
    await expect(this.password).toBeVisible({ timeout: 30_000 });
  }

  /** Set the password, accept the terms, and submit — lands on /onboarding. */
  async setPassword(password: string) {
    await this.password.fill(password);
    await this.confirmPassword.fill(password);
    await this.agree.check();
    await Promise.all([
      this.page.waitForURL(new RegExp(`${TEST_CONFIG.routes.onboarding}(\\?|$|/)`), {
        timeout: 45_000,
      }),
      this.stepSubmit().click(),
    ]);
  }

  /** Full sign-up: choose Merchant → account → OTP → password. `otp` defaults
   *  to `TEST_CONFIG.otp` (the fixed dev-backend value), so existing callers
   *  don't need to pass it; data-driven specs can override it from JSON. */
  async registerMerchant(account: SignUpAccount, password: string, otp: string = TEST_CONFIG.otp) {
    await this.goto();
    await this.selectMerchant();
    await this.fillAccount(account);
    await this.submitOtp(otp);
    await this.setPassword(password);
  }

  /** Full sign-up starting from /login: Sign in page → "Create an Account"
   *  link → choose Partner → account → OTP → password. Lands a fresh
   *  GUESTTHIRDPARTY on /onboarding. */
  async registerPartnerFromLogin(
    account: SignUpAccount,
    password: string,
    otp: string = TEST_CONFIG.otp
  ) {
    await this.gotoFromLogin();
    await this.selectPartner();
    await this.fillAccount(account);
    await this.submitOtp(otp);
    await this.setPassword(password);
  }
}
