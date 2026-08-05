// E2E: GUESTTHIRDPARTY (partner / reseller) self-signup driven by
// `become-a-partner.json`.
//
// Mirrors `partner-sole-application.spec.ts` but every field value comes from
// the JSON fixture. The JSON's `companyType` decides the Business Details
// variant — `/individual/i` routes through the Individual identity block,
// anything else through the company-particulars block. Fields the JSON omits
// are left empty, and document uploads are skipped.
//
// Flow:
//   GUEST sign-up (Partner card) → /onboarding shell
//     → fillPartnerBusinessTab(partner.businessDetails)   // dispatches by companyType
//     → Stakeholders:
//         · Individual variant → `passThroughPartnerIndividualStakeholdersTab`
//           (the row is auto-populated from the identity block and not editable)
//         · everything else    → `fillStakeholdersTab(email, partner.stakeholder)`
//     → fillPartnerPayoutTab(partner.payout)
//     → STOP on Submit step (per project convention)
//
// Edit `playwright/fixtures/onboarding/become-a-partner.json` to drive
// different field values — no spec edit required.
import { test, expect } from '@playwright/test';
import { GuestSignUpPage } from '../../pages/onboarding/GuestSignUpPage';
import { MerchantRegistrationPage } from '../../pages/onboarding/MerchantRegistrationPage';
import { loadPartnerConfig, resolveSignUp } from '../../fixtures/onboarding/load';
import { TEST_CONFIG } from '../../fixtures/test-config';
import { log } from '../../utils/logger';

const HAS_PASSWORD = !!TEST_CONFIG.credentials.password;

test.describe('GUESTTHIRDPARTY partner onboarding — JSON-driven', () => {
  test.skip(!HAS_PASSWORD, 'TEST_PASSWORD env var not set');

  test('fills every tab from become-a-partner.json, stopping at the final step', async ({
    page,
  }) => {
    test.slow();

    const config = loadPartnerConfig();
    const { account, password, otp } = resolveSignUp(config.signUp);
    const signUp = new GuestSignUpPage(page);
    const registration = new MerchantRegistrationPage(page);
    const email = account.email;
    log.info('JSON-driven partner e2e — sign-up email', { email });

    const businessDetails = config.businessDetails ?? {};
    const isIndividual = /individual/i.test(businessDetails.companyType ?? '');

    await test.step('sign up a fresh GUESTTHIRDPARTY (from the /login Sign Up link)', async () => {
      // `registerPartnerFromLogin` is the only partner sign-up entry — there
      // is no direct `registerPartner` because the partner card is only
      // reachable from /choose-account-type via the /login "Create an
      // Account" link. Sign-up fields come from the JSON's `signUp` block;
      // anything omitted falls back to TEST_CONFIG / a generated unique email.
      await signUp.registerPartnerFromLogin(account, password, otp);
    });

    await test.step('land on the Merchant Registration shell (partner flow)', async () => {
      await registration.waitForReady();
      await expect(page).toHaveURL(new RegExp(`${TEST_CONFIG.routes.onboarding}(\\?|$|/)`));
      // Partner wizard drops the Payment Methods step — sanity-check first.
      await expect(
        page.getByRole('tab', { name: /payment methods/i }),
        'partner onboarding wizard should NOT include a Payment Methods step'
      ).toHaveCount(0);
    });

    await test.step('fill Business Details from JSON', async () => {
      await registration.fillPartnerBusinessTab(businessDetails);
    });

    await test.step('Stakeholders — variant-dependent', async () => {
      if (isIndividual) {
        // Individual fills the primary stakeholder row from the identity
        // block in Business Details — the row is auto-populated and the
        // table only exposes a "Complete Your KYC" action, no Edit/Add.
        await registration.passThroughPartnerIndividualStakeholdersTab();
      } else {
        // SOLE / company-shape partners seed a primary stakeholder whose
        // email is the account-creation email (disabled + prefilled).
        await registration.fillStakeholdersTab(email, config.stakeholder);
      }
    });

    await test.step('fill Payout Details from JSON (partner flow → Submit is next)', async () => {
      await registration.fillPartnerPayoutTab(config.payout);
    });

    await test.step('stop at the final step — do NOT submit', async () => {
      await registration.assertOnSubmitStep();
      log.info('JSON-driven partner: reached Submit step (NOT submitted).');
    });
  });
});
