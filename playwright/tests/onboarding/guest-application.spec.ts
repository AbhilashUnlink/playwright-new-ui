// E2E: GUEST creates a merchant onboarding application.
//
// Coverage:
//   1. Full public sign-up — choose-account-type (Merchant) → account form →
//      e-mail OTP → password — which establishes a session and lands the new
//      GUEST on the Merchant Registration shell (/onboarding).
//   2. The first-visit welcome modal + banner are dismissed.
//   3. Every wizard tab is filled and advanced:
//        Business Details → Stakeholders → Payout Details → Payment Methods.
//   4. The flow STOPS on the final (Submit) step — the test asserts the
//      "Submit Application" CTA is reached but deliberately does NOT submit,
//      leaving the application in-progress (PENDING / not submitted).
//
// Each run signs up a brand-new GUEST under a unique email, so the test is
// repeatable without an "email already registered" clash.
//
// Env (playwright/.env — see fixtures/test-config.ts):
//   TEST_PASSWORD            password for the new GUEST account (reused).
//   TEST_OTP                 fixed verification OTP the dev backend accepts.
//   TEST_GUEST_EMAIL_DOMAIN  domain for the generated sign-up address.
// The suite is skipped when TEST_PASSWORD is not set, matching the login
// suite — a fresh checkout doesn't fail noisily before .env is configured.
import { test, expect } from '@playwright/test';
import { GuestSignUpPage } from '../../pages/onboarding/GuestSignUpPage';
import { MerchantRegistrationPage } from '../../pages/onboarding/MerchantRegistrationPage';
import { TEST_CONFIG } from '../../fixtures/test-config';
import { log } from '../../utils/logger';

const HAS_PASSWORD = !!TEST_CONFIG.credentials.password;

test.describe('GUEST onboarding — create an application', () => {
  test.skip(!HAS_PASSWORD, 'TEST_PASSWORD env var not set');

  test('signs up a fresh GUEST and fills every tab, stopping at the final step', async ({
    page,
  }) => {
    test.slow();

    const signUp = new GuestSignUpPage(page);
    const registration = new MerchantRegistrationPage(page);
    const email = GuestSignUpPage.uniqueEmail();
    log.info('GUEST application e2e — sign-up email', { email });

    await test.step('sign up a fresh GUEST merchant', async () => {
      await signUp.registerMerchant(
        { firstName: 'PO', lastName: 'Tester', phone: '9012345678', email },
        TEST_CONFIG.credentials.password
      );
    });

    await test.step('land on the Merchant Registration shell', async () => {
      await registration.waitForReady();
      await expect(page).toHaveURL(new RegExp(`${TEST_CONFIG.routes.onboarding}(\\?|$|/)`));
    });

    await test.step('fill Business Details', async () => {
      await registration.fillBusinessTab();
    });

    await test.step('pass through Stakeholders', async () => {
      // The seeded primary's email field is disabled and prefilled with the
      // account-creation email — `fillStakeholdersTab` asserts that.
      await registration.fillStakeholdersTab(email);
    });

    await test.step('fill Payout Details', async () => {
      await registration.fillPayoutTab();
    });

    await test.step('fill Payment Methods', async () => {
      await registration.fillPaymentTab();
    });

    await test.step('stop at the final step — do NOT submit', async () => {
      await registration.assertOnSubmitStep();
      log.info('Reached the Submit step — leaving the application unsubmitted.');
    });
  });
});
