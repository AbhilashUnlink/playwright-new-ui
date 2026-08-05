// E2E: An already-onboarded THIRDPARTY (reseller / partner) signs in,
// navigates to Sales Lead, clicks "Create Account", and fills the merchant
// onboarding wizard's Business Details tab — which fires the POST that
// actually creates the referral-merchant application server-side.
//
// Flow:
//   /login (TEST_PARTNER_USERNAME / TEST_PARTNER_PASSWORD)
//     → /onboarding/applications (Sales Lead — reseller variant: single list,
//        no tabs, "Create Account" CTA visible)
//     → click "Create Account" → /onboarding (merchant-onboarding shell, no
//        applicationId yet)
//     → fill Business Details → Next
//     → URL flips to /onboarding/details/<newApplicationId>  ← proof the
//        referral merchant was actually created
//     → continue through Stakeholders / Payout / Payment to the Submit step
//     → STOP (per project convention, never submit the dummy application)
//
// The reseller path uses the MERCHANT variant of the wizard (the new account
// being created is a merchant, not another partner), so it gets the full
// four data tabs + Payment Methods step — same surface as the GUEST merchant
// flow, just initiated by a logged-in partner instead of a fresh sign-up.
//
// Skipped when TEST_PARTNER_PASSWORD isn't configured so a fresh checkout
// doesn't fail noisily before .env is set up.
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/auth/LoginPage';
import { MerchantRegistrationPage } from '../../pages/onboarding/MerchantRegistrationPage';
import { TEST_CONFIG } from '../../fixtures/test-config';
import { log } from '../../utils/logger';

const HAS_PARTNER_CREDS =
  !!TEST_CONFIG.partnerCredentials.username && !!TEST_CONFIG.partnerCredentials.password;

test.describe('THIRDPARTY (partner) — creates a referral merchant from Sales Lead', () => {
  test.skip(!HAS_PARTNER_CREDS, 'TEST_PARTNER_USERNAME / TEST_PARTNER_PASSWORD env vars not set');

  test('logs in, navigates to Sales Lead, clicks Create Account, fills Business Details and creates a referral merchant application', async ({
    page,
  }) => {
    test.slow();

    const login = new LoginPage(page);
    const registration = new MerchantRegistrationPage(page);

    await test.step('sign in as the onboarded partner', async () => {
      await login.goto();
      await login.login(
        TEST_CONFIG.partnerCredentials.username,
        TEST_CONFIG.partnerCredentials.password
      );
      // login() already awaits a URL change away from /login.
      await expect(page).not.toHaveURL(new RegExp(TEST_CONFIG.routes.login));
    });

    await test.step('navigate to the Sales Lead applications page', async () => {
      await page.goto(TEST_CONFIG.routes.salesLead, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(new RegExp(TEST_CONFIG.routes.salesLead));
      // Reseller variant of Sales Lead: the page title is rendered, and the
      // tabs strip (Merchant / Partner Applications) is NOT — only
      // SALES / SALESOPS see the tab strip. Asserting both pins the variant
      // and surfaces a role / route-gate regression with a precise message.
      await expect(
        page.getByRole('heading', { name: /sales lead/i }).first(),
        'Sales Lead page should render its title'
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByRole('tab', { name: /partner applications/i }),
        'reseller Sales Lead must NOT show the SALES/SALESOPS tab strip'
      ).toHaveCount(0);
    });

    await test.step('click "Create Account" → land on the merchant-onboarding shell', async () => {
      const createAccount = page.getByRole('button', { name: /create account/i }).first();
      await expect(
        createAccount,
        '"Create Account" CTA should be visible for the THIRDPARTY reseller'
      ).toBeVisible({ timeout: 10_000 });

      await Promise.all([
        page.waitForURL(new RegExp(`${TEST_CONFIG.routes.onboarding}(\\?|$|/)`), {
          timeout: 30_000,
        }),
        createAccount.click(),
      ]);
      await expect(page).toHaveURL(new RegExp(`${TEST_CONFIG.routes.onboarding}(\\?|$|/)`));
    });

    await test.step('wait for the wizard shell — Business Details tab is the active step', async () => {
      // No welcome-overlay probe: the reseller path through
      // `useOnboardingFlow` skips the application fetch, so `loaded` never
      // flips true via that path and `OnboardingPage` never renders the
      // welcome modal / banner (gated on `!salesLeadMode && loaded &&
      // !welcomeModalSeen`). The wizard mounts straight on Business Details.
      await expect(
        page.getByRole('tab', { name: /business details/i, selected: true }),
        'Business Details should be the active step before filling fields'
      ).toBeVisible({ timeout: 30_000 });
    });

    await test.step('fill Business Details for the new referral merchant', async () => {
      // Reseller-created application is a MERCHANT application (the new
      // account being onboarded is a merchant, not another partner), so the
      // standard merchant Business Details fill applies — Company Limited
      // variant, full company particulars + address + brand + docs. Next is
      // the load-bearing assertion: the POST that lands on Next is what
      // actually creates the application server-side.
      await registration.fillBusinessTab();
    });

    await test.step('verify the referral merchant application was created (URL → /onboarding/details/<id>)', async () => {
      // After the first save resolves, `OnboardingPage` replaces the URL
      // with `/onboarding/details/<newApplicationId>`. This is the only
      // place that flip happens, so seeing it is direct proof the POST
      // landed and the backend issued an id — i.e. the referral merchant
      // exists in the system, not just in the local form state.
      await page.waitForURL(/\/onboarding\/details\/[^/?#]+/, { timeout: 30_000 });
      const match = page.url().match(/\/onboarding\/details\/([^/?#]+)/);
      const newApplicationId = match?.[1] ?? '';
      expect(
        newApplicationId,
        'a new application id should appear in the URL after Business Details Next'
      ).not.toBe('');
      log.info('Referral merchant application created', { applicationId: newApplicationId });
    });

    await test.step('continue through Stakeholders / Payout / Payment Methods', async () => {
      // Reseller-created referral merchants land on this tab with an EMPTY
      // stakeholders table — no server-seeded primary row — so the
      // "locked + prefilled email" contract of the GUEST flow does not
      // apply. `fillStakeholdersTabForReseller` opens the Add drawer and
      // types a freshly-generated merchant email into the (editable)
      // `#email` field, saves as a 100% UBO, and advances. Payout / Payment
      // Methods reuse the merchant-flow helpers unchanged.
      const merchantEmail = await registration.fillStakeholdersTabForReseller();
      log.info('Referral merchant primary stakeholder email', { merchantEmail });
      await registration.fillPayoutTab();
      await registration.fillPaymentTab();
    });

    await test.step('stop on the Submit step — do NOT submit the dummy application', async () => {
      await registration.assertOnSubmitStep();
      log.info(
        'Reseller referral-merchant flow: reached Submit Application — leaving the application unsubmitted.'
      );
    });
  });
});
