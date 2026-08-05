// E2E: An already-onboarded THIRDPARTY (reseller / partner) signs in ONCE
// and creates THREE referral-merchant applications back-to-back from Sales
// Lead, without re-authenticating between merchants.
//
// Flow:
//   /login (TEST_PARTNER_USERNAME / TEST_PARTNER_PASSWORD) — once.
//   then loop 3×:
//     /onboarding/applications (Sales Lead — reseller variant)
//       → click "Create Account" → /onboarding (fresh; no applicationId)
//       → fill Business Details → Next
//       → URL flips to /onboarding/details/<newApplicationId>  ← creation proof
//       → fill Stakeholders (reseller helper — empty table, Add only, per-
//          iteration unique email / phone / ID)
//       → fill Payout → fill Payment Methods
//       → land on Submit Application step → STOP (never submit dummies)
//     → page.goto(salesLead) — full document navigation that re-bootstraps
//       Redux. The `onboarding` slice isn't in the redux-persist whitelist
//       (`auth, user, permissions, settings, ui, filters`), so this clears
//       the previous merchant's application from in-memory state. Auth IS
//       persisted, so the partner stays signed in.
//
// Why a hard `page.goto` between iterations (not a `<Link>` click): the SPA
// route from Submit → Sales Lead would be a `pushState`, which doesn't
// re-bootstrap the store. Without a reload the second Create Account would
// re-edit merchant 1 (the URL-flip effect in OnboardingPage fires on the
// stale `application?.id` and `replace()`s into `/onboarding/details/<id1>`).
//
// Why iteration-tagged stakeholder identifiers: the page object's
// `UNIQUE_SUFFIX` is computed once at module load, so all three calls would
// otherwise share one stakeholder email / phone / ID — the dev backend
// rejects identical stakeholder identifiers across applications on the
// save POST. `fillStakeholdersTabForReseller(iteration)` appends an index
// to keep them distinct.
//
// Skipped when TEST_PARTNER_PASSWORD isn't configured.
import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from '../../pages/auth/LoginPage';
import { MerchantRegistrationPage } from '../../pages/onboarding/MerchantRegistrationPage';
import { TEST_CONFIG } from '../../fixtures/test-config';
import { log } from '../../utils/logger';

const HAS_PARTNER_CREDS =
  !!TEST_CONFIG.partnerCredentials.username && !!TEST_CONFIG.partnerCredentials.password;

const MERCHANT_COUNT = 3;

test.describe('THIRDPARTY (partner) — three referral merchants in one login session', () => {
  test.skip(!HAS_PARTNER_CREDS, 'TEST_PARTNER_USERNAME / TEST_PARTNER_PASSWORD env vars not set');

  test(`creates ${MERCHANT_COUNT} referral merchant applications back-to-back from Sales Lead`, async ({
    page,
  }) => {
    // Long-running: three full wizard fills back to back. Per-action timeouts
    // in the POM stay strict; only the overall test budget is relaxed.
    test.slow();

    const login = new LoginPage(page);
    const registration = new MerchantRegistrationPage(page);
    const createdIds: string[] = [];

    await test.step('sign in as the onboarded partner — ONCE for the whole run', async () => {
      await login.goto();
      await login.login(
        TEST_CONFIG.partnerCredentials.username,
        TEST_CONFIG.partnerCredentials.password
      );
      await expect(page).not.toHaveURL(new RegExp(TEST_CONFIG.routes.login));
    });

    for (let iteration = 0; iteration < MERCHANT_COUNT; iteration += 1) {
      // Use a step-group label that surfaces the iteration in the report —
      // a failure inside merchant 2 should be unambiguous from the trace.
      await test.step(`merchant ${iteration + 1} of ${MERCHANT_COUNT}`, async () => {
        const applicationId = await createOneReferralMerchant(page, registration, iteration);
        createdIds.push(applicationId);
      });
    }

    await test.step('all three applications received distinct server-issued ids', async () => {
      expect(createdIds, 'should have created exactly three applications').toHaveLength(
        MERCHANT_COUNT
      );
      const unique = new Set(createdIds);
      expect(
        unique.size,
        `each Create Account flow must produce a new application id — got ${createdIds.join(', ')}`
      ).toBe(MERCHANT_COUNT);
      log.info('Back-to-back referral merchant ids', { createdIds });
    });
  });
});

/**
 * Drive one full Create Account → Submit-step cycle and return the server-
 * issued application id. Lives outside the test body so the loop reads as a
 * single intent ("create one merchant N times") and so each iteration's
 * navigation back to Sales Lead is the ONLY shared state between them.
 *
 * The function MUST start each call from Sales Lead (or any other page) and
 * end each call on the Submit step of `/onboarding/details/<id>`. Returning
 * to Sales Lead between merchants is the caller's job — we use `page.goto`
 * there because it re-bootstraps Redux (see the file header).
 */
async function createOneReferralMerchant(
  page: Page,
  registration: MerchantRegistrationPage,
  iteration: number
): Promise<string> {
  // 1. Navigate to Sales Lead. A hard goto (not a sidebar click) reloads the
  //    document — which is what we want between iterations to clear the
  //    `onboarding` slice (not in the redux-persist whitelist). On the very
  //    first iteration it's the natural entry point anyway.
  await page.goto(TEST_CONFIG.routes.salesLead, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(TEST_CONFIG.routes.salesLead));

  // 2. Reseller-variant sanity: the SALES/SALESOPS tab strip must not show,
  //    and the Create Account CTA must be visible.
  await expect(
    page.getByRole('heading', { name: /sales lead/i }).first(),
    'Sales Lead page should render its title'
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole('tab', { name: /partner applications/i }),
    'reseller Sales Lead must NOT show the SALES/SALESOPS tab strip'
  ).toHaveCount(0);

  // 3. Click Create Account and wait for the wizard shell.
  const createAccount = page.getByRole('button', { name: /create account/i }).first();
  await expect(createAccount, '"Create Account" CTA should be visible').toBeVisible({
    timeout: 10_000,
  });
  await Promise.all([
    page.waitForURL(new RegExp(`${TEST_CONFIG.routes.onboarding}(\\?|$|/)`), {
      timeout: 30_000,
    }),
    createAccount.click(),
  ]);

  // 4. Wait for the wizard shell. No welcome-overlay probe: the reseller
  //    path through `useOnboardingFlow` skips the application fetch, so
  //    `loaded` never flips true via that path and `OnboardingPage` never
  //    renders the welcome modal / banner (gated on `!salesLeadMode &&
  //    loaded && !welcomeModalSeen`). The wizard mounts straight on
  //    Business Details — readiness = that tab being selected.
  await expect(
    page.getByRole('tab', { name: /business details/i, selected: true }),
    'Business Details should be the active step before filling fields'
  ).toBeVisible({ timeout: 30_000 });

  // 5. Fill Business Details — the Next click here is the load-bearing POST
  //    that actually creates the application server-side.
  await registration.fillBusinessTab();

  // 6. Verify the URL flipped from `/onboarding` → `/onboarding/details/<id>`,
  //    which is the only place that flip happens. Capture the new id.
  await page.waitForURL(/\/onboarding\/details\/[^/?#]+/, { timeout: 30_000 });
  const match = page.url().match(/\/onboarding\/details\/([^/?#]+)/);
  const applicationId = match?.[1] ?? '';
  expect(
    applicationId,
    `iteration ${iteration}: new application id should appear in the URL after Business Details Next`
  ).not.toBe('');
  log.info('Referral merchant created', { iteration, applicationId });

  // 7. Fill the remaining tabs. The stakeholder helper takes an iteration
  //    index so each merchant gets a distinct email / phone / ID.
  const merchantEmail = await registration.fillStakeholdersTabForReseller(iteration);
  log.info('Referral merchant primary stakeholder', { iteration, merchantEmail });
  await registration.fillPayoutTab();
  await registration.fillPaymentTab();

  // 8. Reach Submit — never click it.
  await registration.assertOnSubmitStep();
  log.info('Referral merchant reached Submit step (NOT submitted)', {
    iteration,
    applicationId,
  });

  return applicationId;
}
