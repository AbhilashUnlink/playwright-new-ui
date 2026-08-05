// E2E: GUEST merchant onboarding driven by `become-a-merchant.json`.
//
// Mirrors `guest-application.spec.ts` but every field value comes from the
// JSON fixture instead of the hard-coded literals in
// `MerchantRegistrationPage`. Fields the JSON omits are left empty (the
// onboarding tabs save partial progress, so empty fields don't block Next),
// and document uploads are skipped entirely.
//
// Flow:
//   GUEST sign-up (Merchant card) → /onboarding shell
//     → fillBusinessTab(merchant.businessDetails)
//     → fillStakeholdersTab(email, merchant.stakeholder)
//     → fillPayoutTab(merchant.payout)
//     → fillPaymentTab(merchant.paymentMethods)
//     → STOP on Submit step (per project convention)
//
// Edit `playwright/fixtures/onboarding/become-a-merchant.json` to drive
// different field values — no spec edit required.
import { test, expect } from '@playwright/test';
import { GuestSignUpPage } from '../../pages/onboarding/GuestSignUpPage';
import { MerchantRegistrationPage } from '../../pages/onboarding/MerchantRegistrationPage';
import { loadMerchantConfig, resolveSignUp } from '../../fixtures/onboarding/load';
import { TEST_CONFIG } from '../../fixtures/test-config';
import { log } from '../../utils/logger';

const HAS_PASSWORD = !!TEST_CONFIG.credentials.password;

test.describe('GUEST merchant onboarding — JSON-driven', () => {
  test.skip(!HAS_PASSWORD, 'TEST_PASSWORD env var not set');

  test('fills every tab from become-a-merchant.json, stopping at the final step', async ({
    page,
  }) => {
    test.slow();

    const config = loadMerchantConfig();
    const { account, password, otp } = resolveSignUp(config.signUp);
    const signUp = new GuestSignUpPage(page);
    const registration = new MerchantRegistrationPage(page);
    const email = account.email;
    log.info('JSON-driven merchant e2e — sign-up email', { email });

    await test.step('sign up a fresh GUEST merchant from JSON sign-up block', async () => {
      await signUp.registerMerchant(account, password, otp);
    });

    await test.step('land on the Merchant Registration shell', async () => {
      await registration.waitForReady();
      await expect(page).toHaveURL(new RegExp(`${TEST_CONFIG.routes.onboarding}(\\?|$|/)`));
    });

    await test.step('fill Business Details from JSON', async () => {
      await registration.fillBusinessTab(config.businessDetails);
    });

    await test.step('fill Stakeholders from JSON', async () => {
      // The seeded primary's email is the account-creation email — the helper
      // asserts that locked + prefilled field regardless of any `email` value
      // the JSON carries.
      await registration.fillStakeholdersTab(email, config.stakeholder);
    });

    await test.step('fill Payout Details from JSON', async () => {
      await registration.fillPayoutTab(config.payout);
    });

    await test.step('fill Payment Methods from JSON', async () => {
      await registration.fillPaymentTab(config.paymentMethods);
    });

    await test.step('stop at the final step — do NOT submit', async () => {
      await registration.assertOnSubmitStep();
      log.info('JSON-driven merchant: reached Submit step (NOT submitted).');
    });
  });
});
