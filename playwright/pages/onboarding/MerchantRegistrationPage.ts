import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';
import { TEST_CONFIG } from '../../fixtures/test-config';
import type {
  DateConfig,
  MailingAddressConfig,
  MerchantBusinessConfig,
  PartnerBusinessConfig,
  PaymentMethodsConfig,
  PayoutConfig,
  StakeholderConfig,
} from '../../fixtures/onboarding/types';
import { log } from '../../utils/logger';

const FIXTURE_PDF = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/sample-document.pdf'
);

/**
 * Per-process unique suffix appended to every Business Details `legalName`
 * (`companyName`) and `registrationNumber` we fill. The dev backend rejects
 * duplicates with `ERR_AB_0022` ("Duplicate registration number or legalName")
 * on Submit, so a fresh run that reuses prior fixtures fails the final POST.
 * Computing this once at module load (rather than per-fill) keeps every fill
 * within a single test run internally consistent — e.g. the Business tab and
 * any later assertion that re-reads the same value see the same suffix. The
 * base36 timestamp is short enough to fit the backend's column limits.
 */
const UNIQUE_SUFFIX = Date.now().toString(36).toUpperCase();

/**
 * The Add/Edit Stakeholder drawer form's `id` — mirrors
 * `ONBOARDING_STAKEHOLDER_FORM_ID` in
 * `src/components/forms/onboarding-stakeholder/index.tsx`. Used both to
 * detect the open drawer (`#<id>` present) and to target its footer Save
 * button (`button[form="<id>"]`), which lives outside the `<form>`.
 */
const STAKEHOLDER_FORM_ID = 'onboarding-stakeholder-form';

/**
 * One stakeholder's input for `fillStakeholderDrawer`. `email`, `phone` and
 * `identificationId` are kept distinct per stakeholder — three real people
 * shouldn't share contact details, and distinct values keep the saved rows
 * unambiguous to assert on.
 */
interface StakeholderInput {
  firstName: string;
  lastName: string;
  email: string;
  /** Subscriber number — must differ from every other stakeholder's. */
  phone: string;
  identificationId: string;
  /** UBO flag — `true` ticks "Ultimate Beneficial Owner" and fills 100%
   *  ownership; `false` leaves the stakeholder a non-owner (so the drawer's
   *  `100 − others` ownership cap is never breached). */
  ubo: boolean;
  /** The seeded primary stakeholder (the merchant applicant). Its email is the
   *  account-creation email — seeded server-side and rendered **disabled +
   *  prefilled** in the drawer — so the drawer fill asserts that field instead
   *  of typing into it. */
  primary?: boolean;
}

/** The seeded primary stakeholder — edited in place; the sole 100% UBO. Its
 *  phone matches the sign-up phone (the seeded record carries it). `email` is
 *  the merchant account-creation email: the server seeds it onto the primary
 *  record and the drawer shows it disabled + prefilled, so it's supplied
 *  per-run by the tab helper rather than hard-coded here. */
const PRIMARY_STAKEHOLDER: Omit<StakeholderInput, 'email'> = {
  firstName: 'PO',
  lastName: 'Tester',
  phone: '9012345678',
  identificationId: 'E2E-PASS-0001',
  ubo: true,
  primary: true,
};

/** Two extra stakeholders added via the "+" button — non-UBO, since the
 *  primary already holds 100% of the ownership. Each carries its own email,
 *  phone and ID so the cumulative multi-stakeholder POST isn't rejected for
 *  duplicate identifying fields. */
const ADDITIONAL_STAKEHOLDERS: StakeholderInput[] = [
  {
    firstName: 'Hiroshi',
    lastName: 'Sato',
    email: 'hiroshi.sato@po-e2e.example.com',
    phone: '9087654321',
    identificationId: 'E2E-PASS-0002',
    ubo: false,
  },
  {
    firstName: 'Yuki',
    lastName: 'Tanaka',
    email: 'yuki.tanaka@po-e2e.example.com',
    phone: '9076543210',
    identificationId: 'E2E-PASS-0003',
    ubo: false,
  },
];

/**
 * Page object for the GUEST Merchant Registration shell (`/onboarding`).
 *
 * Drives the four wizard tabs — Business Details → Stakeholders → Payout
 * Details → Payment Methods — and stops on the final (Submit) step without
 * submitting.
 *
 * Field-fill is **best-effort**: every onboarding tab saves partial progress
 * and the Next button is never hard-blocked by missing fields, so a helper
 * that can't find a field simply skips it — the flow still advances. The
 * load-bearing assertions are the step transitions, not individual values.
 * The **Stakeholders drawer is the exception** — it is hard-validated (Save
 * is blocked until every required field is valid), so `fillStakeholdersTab`
 * fills it exhaustively.
 *
 * Form controls expose `id={fieldName}`: text inputs are `#name`, the custom
 * `Select` and `MultiSelect` triggers are `#name`, and the upload field's
 * hidden `<input type=file>` is `#name`.
 */
export class MerchantRegistrationPage {
  readonly page: Page;
  readonly nextButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nextButton = page.getByRole('button', { name: /^next$/i }).first();
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  /** Wait for the registration shell, clear the welcome modal/banner, and
   *  wait for the first (Business Details) tab to render. */
  async waitForReady() {
    await this.page.waitForURL(new RegExp(`${TEST_CONFIG.routes.onboarding}(\\?|$|/)`), {
      timeout: 45_000,
    });
    await this.dismissWelcome();
    await this.waitForStep(/business details/i);
  }

  /** First-visit welcome flow — two sequential `role="dialog"` overlays whose
   *  backdrop intercepts pointer events: a modal ("Continue"), then a banner
   *  ("Start Now"). Both must be cleared before any tab field is interactable.
   *
   *  Each stage is awaited with `waitFor` (NOT `isVisible({ timeout })` —
   *  `isVisible` checks immediately and ignores a timeout, so it would race
   *  the modal's first render and skip it). After each click we wait the
   *  stage out, so its backdrop is gone before we touch the next stage /
   *  the form. */
  async dismissWelcome() {
    // Stage 1 — welcome modal. Generous timeout: it renders a tick after load.
    const continueBtn = this.page.getByRole('button', { name: /^continue$/i });
    await continueBtn.waitFor({ state: 'visible', timeout: 25_000 });
    await continueBtn.click();
    await continueBtn.waitFor({ state: 'hidden', timeout: 8_000 });

    // Stage 2 — "Start Now" banner.
    const startNow = this.page.getByRole('button', { name: /start now/i });
    await startNow.waitFor({ state: 'visible', timeout: 8_000 });
    await startNow.click();
    await startNow.waitFor({ state: 'hidden', timeout: 8_000 });

    // Hard gate: no welcome overlay may remain — otherwise its backdrop
    // silently swallows every field click on the tabs below.
    await expect(
      this.page.locator('[role="dialog"][aria-labelledby^="onboarding-welcome"]'),
      'welcome overlay should be dismissed before filling the form'
    ).toHaveCount(0, { timeout: 8_000 });
  }

  // ── tabs ─────────────────────────────────────────────────────────────────

  /** Partner (GUESTTHIRDPARTY) Business Details — Sole Proprietor variant.
   *
   *  Differences vs. the merchant Business tab:
   *   - Adds `thirdPartyType` + `operationalCountry` + `natureOfBusiness`
   *     selects (partner-only fields per the GUESTTHIRDPARTY schema).
   *   - Picks Third Party Type = "Referrers" so neither the conditional
   *     "Other (Third Party Type)" text nor the "Referring countries" multi
   *     -select is revealed.
   *   - Skips `docsShareRegister` (merchant-only) and `corporateWebsite`
   *     (merchant-only; partner schema doesn't render it).
   *   - SOLE partner docs: `docsRC` (Notification of Commencement) +
   *     `docsTaxDeclaration` (Tax confirmation) — the partner SOLE doc set
   *     per `getPartnerBusinessDetailsSchema`.
   *   - Leaves the Regulatory License toggle off so the conditional license
   *     upload never renders.
   *   - Address ordering on the partner schema is postcode → city → address,
   *     but the helpers address each by `#id` so order doesn't matter.
   *
   *  Best-effort like `fillBusinessTab` — a missing field is skipped. The
   *  load-bearing assertion is the Next-button transition to the next step.
   *
   *  `data` is the JSON-driven override (see `fillBusinessTab` for the
   *  contract); when supplied, the helper fills only what's in the config and
   *  skips all document uploads. */
  async fillPartnerSoleBusinessTab(data?: PartnerBusinessConfig) {
    if (data !== undefined) {
      await this.fillPartnerCompanyParticularsFromConfig(data);
      await this.advance(/stakeholders details/i);
      return;
    }
    // Company Particulars
    await this.selectOption('companyType', /sole proprietor/i);
    await this.selectOption('thirdPartyType', /referrers/i, { fallbackToFirst: true });
    await this.fillInput('companyName', `PO E2E Partner SOLE K.K. ${UNIQUE_SUFFIX}`);
    await this.fillInput('doingBusinessAs', 'PO E2E Reseller Brand');
    await this.fillInput('registrationNumber', `E2E-PRT-${UNIQUE_SUFFIX}`);
    await this.selectMultiOption('operationalCountry', /japan/i);
    await this.selectOption('natureOfBusiness', /financial services/i, { fallbackToFirst: true });
    await this.fillDateBestEffort('incorporationDate');
    // Address — partner schema uses postcode/city/registeredAddress.
    await this.fillInput('postcode', '1500001');
    await this.fillInput('city', 'Tokyo');
    await this.fillInput('registeredAddress', '1-1 Test Building, Shibuya');
    // Mailing address — mirror the business address so the (otherwise required)
    // mailing fields drop out of the step % entirely.
    await this.checkBox(/same as (above|mailing|business address)/i);
    // SOLE partner doc bucket — Notification of Commencement + Tax confirmation.
    await this.uploadFile('docsRC');
    await this.uploadFile('docsTaxDeclaration');
    await this.advance(/stakeholders details/i);
  }

  /** Partner (GUESTTHIRDPARTY) Business Details — Individual variant.
   *
   *  Individual is a partner-only Company Type that swaps the company
   *  particulars for an identity block per
   *  `getPartnerBusinessDetailsSchema(...)` → `individualBefore` +
   *  (non-schema) `IndividualPhoneField` + `individualAfterPhone`.
   *
   *  Field set (no Industry / Operational Countries / Incorporation Date /
   *  Brand Name / Regulatory License — all hidden for Individual):
   *   - companyType = Individual
   *   - thirdPartyType (we pick Referrers — no conditional extras)
   *   - companyName (relabelled "Full Name as per ID" — wire key unchanged)
   *   - indDob (≥18)
   *   - indNationality
   *   - indPhoneNumber (non-schema merged dial+number, addressed by its
   *     placeholder — same placeholder the stakeholder phone uses, but on
   *     this tab there's only the one phone field so it's unambiguous)
   *   - indIdentificationType (we pick Passport — keeps the Expiry field
   *     required, matches the schema's non-NATIONALID branch)
   *   - indIdentificationIssuedDate / indIdentificationExpDate
   *   - registrationNumber (relabelled "ID Number")
   *   - address: postcode / city / registeredAddress
   *   - mailing: mirrored via "same as above"
   *   - docs: docsRC (Valid Passport / MyNumber / DL / Health Insurance) +
   *           docsTaxDeclaration (Bank statement / Utility bill / Tenancy)
   *
   *  Best-effort like the other tab fills — a missing field is skipped, and
   *  the load-bearing assertion is the transition to the next step.
   *
   *  `data` is the JSON-driven override; when supplied, only listed fields
   *  are filled and document uploads are skipped. */
  async fillPartnerIndividualBusinessTab(data?: PartnerBusinessConfig) {
    if (data !== undefined) {
      await this.fillPartnerIndividualBusinessFromConfig(data);
      await this.advance(/stakeholders details/i);
      return;
    }
    // Identity block — first half (before the non-schema phone field).
    await this.selectOption('companyType', /^individual$/i);
    await this.selectOption('thirdPartyType', /referrers/i, { fallbackToFirst: true });
    await this.fillInput('companyName', `Yamada Taro ${UNIQUE_SUFFIX}`);
    await this.pickCalendarDate('indDob', -30); // safely ≥18
    await this.selectOption('indNationality', /japan/i, { fallbackToFirst: true });
    // Non-schema merged dial+number — the number input has no `#id`, so
    // `getByPlaceholder` is used (matches "Enter Phone Number"). The dial
    // keeps its default (+81), which is fine for the partner Individual flow.
    await this.page
      .getByPlaceholder(/enter phone number/i)
      .first()
      .fill('9012345678')
      .catch(() => {});
    // Identity block — second half (after the phone field).
    await this.selectOption('indIdentificationType', /passport/i, { fallbackToFirst: true });
    await this.pickCalendarDate('indIdentificationIssuedDate', -1); // issued last year
    await this.pickCalendarDate('indIdentificationExpDate', 5); // expires in 5 years
    await this.fillInput('registrationNumber', `E2E-IND-PASS-${UNIQUE_SUFFIX}`);
    // Address — partner schema ordering: postcode → city → registered address.
    await this.fillInput('postcode', '1500001');
    await this.fillInput('city', 'Tokyo');
    await this.fillInput('registeredAddress', '1-1 Test Building, Shibuya');
    // Mailing — mirror the business address so its required fields drop
    // out of the step % entirely.
    await this.checkBox(/same as (above|mailing|business address)/i);
    // Individual doc bucket — ID document + Proof of address.
    await this.uploadFile('docsRC');
    await this.uploadFile('docsTaxDeclaration');
    await this.advance(/stakeholders details/i);
  }

  /** JSON-driven dispatcher for the partner Business Details tab — picks the
   *  Individual identity-block fill when `data.companyType` matches
   *  /individual/i, else the SOLE / company-particulars fill. Convenience so
   *  a spec that loads `become-a-partner.json` doesn't need to branch itself. */
  async fillPartnerBusinessTab(data: PartnerBusinessConfig) {
    const isIndividual = /individual/i.test(data.companyType ?? '');
    if (isIndividual) {
      await this.fillPartnerIndividualBusinessTab(data);
    } else {
      await this.fillPartnerSoleBusinessTab(data);
    }
  }

  /** Business Details — company particulars, address, mailing address (mirrored
   *  via "Same as above"), brand + doc uploads. Ticking "Same as above" mirrors
   *  the business address into the mailing fields so the otherwise-required
   *  mailing block drops out of the step % and the application carries a
   *  complete mailing address on save.
   *
   *  `data` is the JSON-driven override: when provided, only fields present in
   *  the config are filled and document uploads are skipped (the page tabs save
   *  partial progress, so empty fields don't block Next). When `undefined`, the
   *  legacy hard-coded Company-Limited path runs unchanged. */
  async fillBusinessTab(data?: MerchantBusinessConfig) {
    if (data !== undefined) {
      await this.fillBusinessTabFromConfig(data);
      await this.advance(/stakeholders details/i);
      return;
    }
    await this.selectOption('companyType', /company limited/i);
    await this.fillInput('companyName', `PO E2E Merchant K.K. ${UNIQUE_SUFFIX}`);
    await this.fillInput('registrationNumber', `E2E-REG-${UNIQUE_SUFFIX}`);
    await this.fillDateBestEffort('incorporationDate');
    await this.fillInput('registeredAddress', '1-1 Test Building, Shibuya');
    await this.fillInput('city', 'Tokyo');
    await this.fillInput('postcode', '1500001');
    await this.checkBox(/same as (above|mailing|business address)/i);
    await this.fillInput('doingBusinessAs', 'PO E2E Store');
    await this.fillInput('corporateWebsite', 'https://po-e2e.example.com');
    await this.uploadFile('docsRC');
    await this.uploadFile('docsShareRegister');
    await this.uploadFile('docsTaxDeclaration');
    await this.advance(/stakeholders details/i);
  }

  /** Stakeholders — reseller-created referral merchant variant.
   *
   *  When a partner (THIRDPARTY) creates a referral merchant the stakeholders
   *  table is **empty** — there is no server-seeded primary row, so the
   *  "primary stakeholder email is locked + prefilled" contract does NOT
   *  apply. The Edit button is absent; only "Add Stakeholder" is rendered.
   *
   *  So this opens the Add drawer, fills a single UBO stakeholder with a
   *  freshly-generated merchant email (typed into the editable `#email`
   *  field, not asserted disabled), saves at 100% ownership, and advances.
   *
   *  `iteration` keeps the email / phone / ID number unique across multiple
   *  back-to-back creates in the same run (the dev backend's cross-
   *  application uniqueness checks reject identical stakeholder identifiers
   *  on the save POST, even though duplicate company names / registration
   *  numbers only trip the Submit). Defaults to 0 — single-merchant callers
   *  can keep ignoring it.
   *
   *  Returns the merchant email it used so the test can log it / assert
   *  against the persisted application if needed.
   *
   *  `data` is the JSON-driven override; when supplied, every field comes from
   *  the config (with `applyUnique` substituting `{{unique}}`). The merchant
   *  email is still iteration-tagged so back-to-back creates stay distinct —
   *  the helper substitutes the tagged email into the editable `#email` field
   *  regardless of any `email` value the config carries. */
  async fillStakeholdersTabForReseller(
    iteration: number = 0,
    data?: StakeholderConfig
  ): Promise<string> {
    const iterTag = String(iteration).padStart(2, '0');
    const merchantEmail = `po-e2e-referral-${UNIQUE_SUFFIX.toLowerCase()}-${iterTag}@po-e2e.example.com`;
    if (data !== undefined) {
      const stakeholderWithEmail: StakeholderConfig = { ...data, email: merchantEmail };
      await this.openStakeholderDrawer();
      await this.fillStakeholderDrawerFromConfig(stakeholderWithEmail, undefined);
      // The saved row is keyed off the unique email (which proves the save
      // POST echoed it back) — the visible-cell assertion uses the
      // stakeholder's first name from the config (or "PO" if absent).
      await this.saveStakeholderDrawer(
        { email: merchantEmail } as StakeholderInput,
        stakeholderWithEmail.firstName ?? 'PO'
      );
      await this.advance(/payout details/i);
      return merchantEmail;
    }
    // Append the iteration index to every identifying field so a loop that
    // creates N merchants in the same module-load cycle (one UNIQUE_SUFFIX)
    // still produces N distinct stakeholders. Phone keeps a fixed prefix
    // and a numerically distinct trailing block so it stays a valid digit
    // string (the field has no formatter, but the schema rejects letters).
    const stakeholder: StakeholderInput = {
      firstName: 'PO',
      lastName: `Referral${iterTag}`,
      email: merchantEmail,
      // 10-digit number — distinct trailing block per iteration so two
      // back-to-back stakeholders don't share a phone.
      phone: `90100000${iterTag}`,
      identificationId: `E2E-REF-${UNIQUE_SUFFIX}-${iterTag}`,
      ubo: true,
      // `primary: false` is the load-bearing bit: it routes
      // `fillStakeholderDrawer` through the `fillInput('email', …)` branch
      // instead of `assertPrimaryEmailLocked()`, which would fail here
      // because the reseller-created application has no seeded primary
      // and the email field is editable, not disabled.
    };
    await this.openStakeholderDrawer(); // falls back to "Add" — Edit is absent
    await this.fillStakeholderDrawer(stakeholder);
    await this.saveStakeholderDrawer(stakeholder, '100%');
    await this.advance(/payout details/i);
    return merchantEmail;
  }

  /** Stakeholders — a primary stakeholder is seeded at registration. Open its
   *  Edit drawer, fill the (hard-validated) Add/Edit Stakeholder form end to
   *  end, Save, then advance. Unlike the partial-save page tabs, the drawer
   *  blocks Save until every required field is valid — so this fill is
   *  exhaustive, and `saveStakeholderDrawer` fails loudly if anything is
   *  missed (the drawer simply never closes).
   *
   *  `accountEmail` is the GUEST's account-creation email — the primary
   *  stakeholder's email field is seeded with it and rendered disabled, so the
   *  drawer fill asserts that rather than typing a new value.
   *
   *  `data` is the JSON-driven override; when supplied, every field comes
   *  from the config. The primary stakeholder's email field stays locked +
   *  prefilled regardless of any `email` the config carries — the helper
   *  asserts against `accountEmail`. The saved row is matched by the UBO
   *  ownership cell (`100%`) when `data.ubo` is true, else by first name. */
  async fillStakeholdersTab(accountEmail: string, data?: StakeholderConfig) {
    if (data !== undefined) {
      await this.openStakeholderDrawer();
      await this.fillStakeholderDrawerFromConfig(data, accountEmail);
      const savedCell = data.ubo === true ? '100%' : (data.firstName ?? 'PO');
      await this.saveStakeholderDrawer({ email: accountEmail } as StakeholderInput, savedCell);
      await this.advance(/payout details/i);
      return;
    }
    const primary: StakeholderInput = { ...PRIMARY_STAKEHOLDER, email: accountEmail };
    await this.openStakeholderDrawer();
    await this.fillStakeholderDrawer(primary);
    await this.saveStakeholderDrawer(primary, '100%');
    await this.advance(/payout details/i);
  }

  /** Stakeholders, multi-stakeholder variant — exercises the "+" Add flow.
   *  The seeded primary is edited (the 100% UBO), then two more stakeholders
   *  are added via the Add button, for **three** in total. The added two are
   *  non-UBO: the primary already holds 100%, so a second UBO would breach the
   *  drawer's `100 − others` ownership cap and block Save. Each add fully
   *  settles (row visible in the table) before the next drawer opens, so the
   *  drawer always builds on an up-to-date stakeholder list.
   *
   *  `accountEmail` is the GUEST's account-creation email — the primary
   *  stakeholder's email is seeded with it and shown disabled in the drawer. */
  async fillStakeholdersTabWithThree(accountEmail: string) {
    // 1 — the seeded primary: edit it in place. Its email is the GUEST's
    // account-creation email, shown disabled + prefilled in the drawer.
    const primary: StakeholderInput = { ...PRIMARY_STAKEHOLDER, email: accountEmail };
    await this.openStakeholderDrawer();
    await this.fillStakeholderDrawer(primary);
    await this.saveStakeholderDrawer(primary, '100%');
    // 2 & 3 — added through the "+" button.
    for (const stakeholder of ADDITIONAL_STAKEHOLDERS) {
      await this.addStakeholder(stakeholder);
    }
    // All three rows must be listed before leaving the step.
    for (const { firstName } of [PRIMARY_STAKEHOLDER, ...ADDITIONAL_STAKEHOLDERS]) {
      await expect(
        this.page.getByRole('cell', { name: firstName }).first(),
        `stakeholder "${firstName}" should be listed in the table`
      ).toBeVisible({ timeout: 15_000 });
    }
    await this.advance(/payout details/i);
  }

  /** Partner Individual — the Stakeholders row is **auto-populated** from
   *  the Business Details identity block and is **not editable**: the
   *  table only exposes a "COMPLETE YOUR KYC" action, not Edit/Add, so the
   *  drawer-based fill the other flows use never applies here. We just
   *  advance to Payout (Next is never hard-blocked by stakeholder %). */
  async passThroughPartnerIndividualStakeholdersTab() {
    await expect(
      this.page.getByRole('button', { name: /complete your kyc/i }).first(),
      'partner Individual should show the seeded primary stakeholder row with a Complete Your KYC action'
    ).toBeVisible({ timeout: 15_000 });
    await this.advance(/payout details/i);
  }

  /** Partner (GUESTTHIRDPARTY) Payout Details — same fields as the merchant
   *  flow, but the partner wizard has NO Payment Methods step, so this
   *  advances straight to the final (Submit Application) step.
   *
   *  `data` is the JSON-driven override; when supplied, only listed fields
   *  are filled and document uploads are skipped. */
  async fillPartnerPayoutTab(data?: PayoutConfig) {
    if (data !== undefined) {
      await this.fillPayoutTabFromConfig(data);
      // Sanity guard: paymentFrequency must NOT render on the partner schema —
      // the JSON path doesn't fill it on the partner flow regardless of what
      // the config says, but the parity assertion still belongs here.
      await expect(
        this.page.locator('#paymentFrequency'),
        'paymentFrequency must not render for partner (v3.1 parity)'
      ).toHaveCount(0);
      await this.advance(/submit application/i);
      return;
    }
    // Partner payout field set (v3.1 parity — `paymentFrequency` is hidden
    // for resellers by `getPayoutDetailsSchema(t, currency, isPartner)`):
    //   Account Number · Account Type · Settlement Currency · Bank Name ·
    //   Bank Code · Country of Bank · Branch Code · Bank Account Name · docs.
    // Trying to touch `#paymentFrequency` here would time out — the trigger
    // is not in the DOM for partner applications.
    await this.fillInput('accountNumber', '12345678');
    await this.selectOption('accountType', /saving|normal|current/i);
    await this.selectOption('settlementCurrency', /jpy/i);
    await this.fillInput('bankName', 'PO E2E Bank');
    await this.fillInput('bankCode', 'POE0001');
    await this.selectOption('bankCountry', /local/i);
    await this.fillInput('branchCode', 'BR0001');
    await this.fillInput('bankAccountName', 'PO E2E Partner SOLE K.K.');
    await this.uploadFile('docs');
    // Sanity guard: paymentFrequency must NOT render on the partner schema.
    // If it ever comes back, that's a parity regression — flag it loudly
    // here so we catch it in CI instead of in production traffic.
    await expect(
      this.page.locator('#paymentFrequency'),
      'paymentFrequency must not render for partner (v3.1 parity)'
    ).toHaveCount(0);
    await this.advance(/submit application/i);
  }

  /** Payout Details — local bank account + a bank-statement upload.
   *
   *  `data` is the JSON-driven override; when supplied, only listed fields
   *  are filled and the bank-statement upload is skipped. */
  async fillPayoutTab(data?: PayoutConfig) {
    if (data !== undefined) {
      await this.fillPayoutTabFromConfig(data);
      await this.advance(/payment methods/i);
      return;
    }
    await this.fillInput('accountNumber', '12345678');
    await this.selectOption('accountType', /saving|normal|current/i);
    // settlementCurrency BEFORE paymentFrequency — picking currency rebuilds
    // the payout schema, which remounts the paymentFrequency Select.
    await this.selectOption('settlementCurrency', /jpy/i);
    // "How often would you like to get paid" — strict-select so a missed
    // click can't silently leave it empty.
    await this.selectOptionStrict('paymentFrequency', 'Weekly');
    await this.fillInput('bankName', 'PO E2E Bank');
    await this.fillInput('bankCode', 'POE0001');
    await this.selectOption('bankCountry', /local/i);
    await this.fillInput('branchCode', 'BR0001');
    await this.fillInput('bankAccountName', 'PO E2E Merchant K.K.');
    await this.uploadFile('docs');
    // Guard against a late re-render clearing the just-committed value.
    await expect(
      this.page.locator('#paymentFrequency'),
      'paymentFrequency must still hold its value right before Next'
    ).toContainText(/weekly|daily/i);
    await this.advance(/payment methods/i);
  }

  /** Payment Methods — enable a product, then product/settlement details.
   *
   *  `data` is the JSON-driven override; when supplied, only listed fields
   *  are filled. Acceptance toggles flip on only when their JSON key is
   *  explicitly `true` (omit → leave off). */
  async fillPaymentTab(data?: PaymentMethodsConfig) {
    if (data !== undefined) {
      await this.fillPaymentTabFromConfig(data);
      await this.clickNext();
      return;
    }
    await this.toggleOn('hasHpp');
    // `website` only renders once an online-checkout method is on.
    await this.fillInput('website', 'https://po-e2e.example.com');
    await this.fillInput('describeProduct', 'Digital goods and online services.');
    await this.selectMultiOption('transactionalCountries', /japan/i);
    await this.fillInput('maximumTransactionAmount', '100000');
    await this.fillInput('averageTransactionAmount', '5000');
    await this.fillInput('totalAnnualProjectionAmount', '1000000');
    await this.clickNext();
  }

  // ── final step ───────────────────────────────────────────────────────────

  /** Assert the wizard reached the final (Submit) step and stop there — the
   *  test deliberately does NOT submit the application.
   *
   *  "Submit Application" is the step-strip *tab* (`role="tab"`), never a
   *  button — so arrival keys off that tab being selected. The final step
   *  renders one of two UIs by overall %: below 100% the incomplete view,
   *  at 100% the `SubmitApplicationForm` ("I agree"). A stakeholder whose
   *  eKYC is not Completed caps the Stakeholders step at 95%, so a
   *  fully-filled application still totals 99% — the incomplete view, not
   *  the "I agree" form. So this only asserts arrival on the tab. */
  async assertOnSubmitStep() {
    await expect(
      this.page.getByRole('tab', { name: /submit application/i, selected: true }),
      'the wizard should be on the final (Submit) step'
    ).toBeVisible({ timeout: 30_000 });
    // The submit step's footer drops the Next button.
    await expect(this.page.getByRole('button', { name: /^next$/i })).toHaveCount(0);
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Click Next, then wait until the next step is actually active (Next on
   *  the form tabs submits + saves before advancing, hence the generous
   *  timeout). */
  private async advance(nextStep: RegExp) {
    await this.clickNext();
    await this.waitForStep(nextStep);
  }

  async clickNext() {
    await this.nextButton.click();
  }

  /** Wait until the named wizard step is the *active* one. The step strip's
   *  tabs carry `aria-selected`, so keying off the selected tab waits for the
   *  real step transition. Matching heading text does NOT work: every tab
   *  label ("Payout Details", …) is always in the DOM, so a text match
   *  resolves before the step changes — which let the Next clicks race ahead
   *  of the wizard and land `clickNext` on the wrong (Next-less) step. */
  private async waitForStep(name: RegExp) {
    await expect(this.page.getByRole('tab', { name, selected: true })).toBeVisible({
      timeout: 30_000,
    });
  }

  /** Fill a text/number input by field id — no-op when the field isn't on
   *  the current tab (conditional fields) or is read-only. Some fields are
   *  pre-filled and locked for certain applicant types (e.g. the Sole-Prop
   *  primary stakeholder's `ownershipPercentage`, fixed at 100 and disabled):
   *  `isEditable` skips those instead of waiting out `fill`'s actionability
   *  timeout on a field that will never become enabled. */
  private async fillInput(id: string, value: string) {
    const el = this.page.locator(`#${id}`);
    if (await el.isEditable().catch(() => false)) {
      await el.fill(value);
    }
  }

  /** Strict variant of `selectOption` — opens the `Select`, picks the option
   *  whose **trigger text** afterwards exactly equals `optionLabel`, and
   *  asserts the trigger's visible text actually updated.
   *
   *  Use this for fields like `paymentFrequency` whose parent schema rebuilds
   *  on a sibling change (`settlementCurrency` → schema useMemo rebuild,
   *  Select remount): the looser `selectOption` swallows a missed click as a
   *  warning, so the field silently stays empty and only surfaces as "the
   *  value got removed" on the next step. This one fails loudly. */
  private async selectOptionStrict(id: string, optionLabel: string) {
    const trigger = this.page.locator(`#${id}`);
    await expect(trigger, `select trigger #${id} should be visible`).toBeVisible({
      timeout: 10_000,
    });
    await expect(trigger, `select trigger #${id} should be enabled`).toBeEnabled();
    await trigger.click();
    // Anchor on the *just-opened* portal — searchable Selects autofocus their
    // search input, which can prepend a "Clear search" button to the same
    // portal; matching by exact button text avoids hitting it.
    const option = this.page
      .locator('[data-filter-portal="true"] button', { hasText: new RegExp(`^${optionLabel}$`) })
      .first();
    await option.waitFor({ state: 'visible', timeout: 5_000 });
    await option.click();
    // The Select renders the chosen label inside the trigger. Assert it
    // committed — Playwright retries until the trigger DOM updates, so a
    // schema-rebuild remount that lands mid-click can't pass us by.
    await expect(trigger, `#${id} should display the chosen option "${optionLabel}"`).toContainText(
      optionLabel,
      { timeout: 5_000 }
    );
  }

  /** Drive the custom `Select`: open the trigger, then pick the first option
   *  whose label matches. Skips a locked/absent select. The portaled menu is
   *  awaited with `waitFor` (it mounts a tick after the click).
   *
   *  `fallbackToFirst` picks the first option in the menu when nothing
   *  matches `optionText` — needed for the hard-validated stakeholder drawer,
   *  where a select left empty would block Save (the page tabs tolerate a
   *  miss and just leave the field blank). */
  private async selectOption(id: string, optionText: RegExp, opts?: { fallbackToFirst?: boolean }) {
    const trigger = this.page.locator(`#${id}`);
    if (!(await trigger.isVisible().catch(() => false))) return;
    if (await trigger.isDisabled().catch(() => false)) return;
    await trigger.click();
    const menu = this.page.locator('[data-filter-portal="true"] button');
    try {
      await menu.filter({ hasText: optionText }).first().click({ timeout: 5_000 });
    } catch {
      if (opts?.fallbackToFirst) {
        await menu
          .first()
          .click({ timeout: 5_000 })
          .catch(() => {
            log.warn('Select option not found', { field: id });
            return this.page.keyboard.press('Escape').catch(() => {});
          });
      } else {
        log.warn('Select option not found', { field: id });
        await this.page.keyboard.press('Escape').catch(() => {});
      }
    }
  }

  /** Pick one option in a custom `MultiSelect` (addressed, like `Select`, by
   *  `id={fieldName}` on its trigger). Two differences from `selectOption`:
   *  its menu rows are `<label>`s — not `<button>`s — and the menu stays open
   *  after a pick, so the trigger is re-clicked to close it (otherwise its
   *  portal would cover the fields below). Best-effort: a miss is skipped. */
  private async selectMultiOption(id: string, optionText: RegExp) {
    const trigger = this.page.locator(`#${id}`);
    if (!(await trigger.isVisible().catch(() => false))) return;
    if (await trigger.isDisabled().catch(() => false)) return;
    await trigger.click();
    await this.page
      .locator('[data-filter-portal="true"] label')
      .filter({ hasText: optionText })
      .first()
      .click({ timeout: 5_000 })
      .catch(() => log.warn('MultiSelect option not found', { field: id }));
    await trigger.click().catch(() => {});
  }

  /** Attach the sample PDF to an upload field's hidden file input. */
  private async uploadFile(id: string) {
    const input = this.page.locator(`#${id}`);
    if ((await input.count()) > 0) {
      await input.setInputFiles(FIXTURE_PDF).catch((err) => {
        log.warn('Upload failed', { field: id, error: (err as Error).message });
      });
    }
  }

  /** Best-effort calendar date pick (the date inputs are calendar-only).
   *  A miss is tolerated — the field stays empty and the flow still advances. */
  private async fillDateBestEffort(id: string) {
    const input = this.page.locator(`#${id}`);
    if (!(await input.isVisible().catch(() => false))) return;
    try {
      await input.click();
      await this.page
        .locator('.react-datepicker__day--today:not(.react-datepicker__day--disabled)')
        .first()
        .click({ timeout: 3_000 });
    } catch {
      await this.page.keyboard.press('Escape').catch(() => {});
    }
  }

  /** Turn an acceptance toggle on if it isn't already. */
  private async toggleOn(id: string) {
    const toggle = this.page.locator(`#${id}`);
    if (!(await toggle.isVisible().catch(() => false))) return;
    const pressed = await toggle.getAttribute('aria-checked').catch(() => null);
    if (pressed === 'true') return;
    await toggle.click().catch(() => {});
  }

  /** Tick a checkbox addressed by its (label-derived) accessible name. No-op
   *  if absent; `check()` is idempotent so an already-ticked box is fine. */
  private async checkBox(name: RegExp) {
    const box = this.page.getByRole('checkbox', { name });
    if (!(await box.isVisible().catch(() => false))) return;
    await box.check().catch(() => {});
  }

  /** Pick a date in a `react-datepicker` calendar `yearsOffset` years from
   *  the month it opens on (negative = past, e.g. DOB; positive = future,
   *  e.g. an ID expiry). The input is calendar-only (typing is blocked), so
   *  navigation is keyboard-driven: `ArrowDown` moves focus from the input
   *  into the day grid, then `Shift+PageUp` / `Shift+PageDown` jump a year at
   *  a time — the same a11y shortcuts react-datepicker binds. We then click
   *  the 15th, which is always mid-month and so never disabled by a
   *  min/max date that lands on a month boundary. */
  private async pickCalendarDate(id: string, yearsOffset: number) {
    const input = this.page.locator(`#${id}`);
    if (!(await input.isVisible().catch(() => false))) return;
    await input.click();
    const calendar = this.page.locator('.react-datepicker').first();
    const opened = await calendar
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!opened) return;
    await this.page.keyboard.press('ArrowDown');
    const yearKey = yearsOffset < 0 ? 'Shift+PageUp' : 'Shift+PageDown';
    for (let i = 0; i < Math.abs(yearsOffset); i += 1) {
      await this.page.keyboard.press(yearKey);
    }
    await calendar
      .locator(
        '.react-datepicker__day:not(.react-datepicker__day--outside-month):not(.react-datepicker__day--disabled)'
      )
      .filter({ hasText: /^15$/ })
      .first()
      .click({ timeout: 5_000 })
      .catch(() => this.page.keyboard.press('Escape').catch(() => {}));
  }

  /** Open the Add Stakeholder drawer via the "+" button (always present for a
   *  non-SOLE company type) and wait for its form to mount. */
  private async openAddStakeholderDrawer() {
    await this.page
      .getByRole('button', { name: /add stakeholder/i })
      .first()
      .click();
    await this.page
      .locator(`#${STAKEHOLDER_FORM_ID}`)
      .waitFor({ state: 'visible', timeout: 15_000 });
  }

  /** Add one stakeholder through the "+" drawer: open, fill, save, and wait
   *  for the new row to surface — keyed on its first name, since an added
   *  (non-UBO) stakeholder has no `100%` shareholding cell to wait on. */
  private async addStakeholder(stakeholder: StakeholderInput) {
    await this.openAddStakeholderDrawer();
    await this.fillStakeholderDrawer(stakeholder);
    await this.saveStakeholderDrawer(stakeholder, stakeholder.firstName);
  }

  /** Open the Add/Edit Stakeholder drawer — Edit the first (primary) row when
   *  the table has one, else fall back to the "+" Add button. Resolves once
   *  the drawer's form has mounted. */
  private async openStakeholderDrawer() {
    const editBtn = this.page.getByRole('button', { name: /edit stakeholder/i }).first();
    const addBtn = this.page.getByRole('button', { name: /add stakeholder/i }).first();
    await editBtn.or(addBtn).first().waitFor({ state: 'visible', timeout: 15_000 });
    if (await editBtn.isVisible().catch(() => false)) {
      await editBtn.click();
    } else {
      await addBtn.click();
    }
    await this.page
      .locator(`#${STAKEHOLDER_FORM_ID}`)
      .waitFor({ state: 'visible', timeout: 15_000 });
  }

  /** Fill every field of the Add/Edit Stakeholder form — particulars,
   *  authorized signatory, address, and identification.
   *
   *  `opts.ubo` decides whether this stakeholder is flagged a UBO: when true
   *  the hard-validated ownership field is revealed and filled to 100%; when
   *  false (an *added* stakeholder, alongside a primary that already holds
   *  100%) it is skipped, so the drawer's `100 − others` cap never blocks. */
  private async fillStakeholderDrawer(opts: StakeholderInput) {
    // Particulars
    await this.fillInput('firstName', opts.firstName);
    await this.fillInput('middleName', 'E2E');
    await this.fillInput('lastName', opts.lastName);
    await this.pickCalendarDate('dob', -20); // ≥18 — clear the age floor
    // Phone (`telePhoneNumber`) has no id — the input is addressed by its
    // placeholder. Distinct per stakeholder (see `StakeholderInput`).
    await this.page
      .getByPlaceholder(/enter phone number/i)
      .fill(opts.phone)
      .catch(() => {});
    // Email — the primary stakeholder is the merchant applicant: their email
    // is the account login, seeded server-side and rendered disabled +
    // prefilled. Assert that contract rather than typing into it; every other
    // (added) stakeholder gets its own editable email.
    if (opts.primary) {
      await this.assertPrimaryEmailLocked(opts.email);
    } else {
      await this.fillInput('email', opts.email);
    }
    await this.selectOption('nationality', /japan/i, { fallbackToFirst: true });
    if (opts.ubo) {
      // UBO → reveals the (hard-validated, min 25%) ownership field.
      await this.checkBox(/ultimate beneficial owner/i);
      await this.page
        .locator('#ownershipPercentage')
        .waitFor({ state: 'visible', timeout: 5_000 })
        .catch(() => {});
      await this.fillInput('ownershipPercentage', '100');
    }
    await this.checkBox(/authorized signatory/i);
    // Address
    await this.selectOption('countryOfResidence', /japan/i, { fallbackToFirst: true });
    await this.fillInput('postcode', '1500001');
    await this.fillInput('address', '1-1 Test Building, Shibuya');
    await this.fillInput('city', 'Tokyo');
    // Identification
    await this.selectOption('identificationType', /passport/i, { fallbackToFirst: true });
    await this.fillInput('identificationId', opts.identificationId);
    await this.pickCalendarDate('identificationIssuedDate', -1); // issued last year
    await this.pickCalendarDate('identificationExpDate', 5); // expires in 5 years
  }

  /** The primary stakeholder's email field is the merchant account login — it
   *  is rendered **disabled** and **prefilled** with the email the GUEST gave
   *  at account creation. Assert both: the field is never editable here, and
   *  it must already carry that exact address. */
  private async assertPrimaryEmailLocked(accountEmail: string) {
    const emailField = this.page.locator('#email');
    await expect(
      emailField,
      'the primary stakeholder email field should be disabled'
    ).toBeDisabled();
    await expect(
      emailField,
      'the primary stakeholder email should be prefilled with the account-creation email'
    ).toHaveValue(accountEmail);
  }

  /** Submit the stakeholder drawer and verify the save **actually persisted**.
   *
   *  The Save fires a *fire-and-forget* POST (`saveStakeholders` →
   *  `void dispatch(...)`). On a **rejected** POST the slice's graceful
   *  fallback (`mergeTab`) still paints the row into Redux — so the table
   *  cell appears and the step % reads 100% even though nothing reached the
   *  backend. A UI-only wait therefore passes on data that was never saved
   *  (exactly the "stakeholders not getting saved" symptom). So this:
   *   1. captures the `POST onboarding/application` response,
   *   2. asserts it is 2xx,
   *   3. asserts the response echoes this stakeholder back in `stakeholders`
   *      (matched by its unique email) — a 2xx that dropped the record is
   *      still a failed save,
   *   4. then confirms the drawer closed and the row rendered.
   *
   *  `savedCell` is the table-cell text proving the row rendered — `100%` for
   *  the 100%-UBO primary, the (unique) first name for an added stakeholder. */
  private async saveStakeholderDrawer(stakeholder: StakeholderInput, savedCell: string | RegExp) {
    // Arm the response wait BEFORE the click — the POST can resolve fast.
    const savePromise = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/onboarding\/application\/?($|\?)/.test(r.url()),
      { timeout: 20_000 }
    );
    await this.page.locator(`button[form="${STAKEHOLDER_FORM_ID}"]`).click();

    const response = await savePromise;
    const bodyText = await response.text().catch(() => '');
    expect(
      response.ok(),
      `stakeholder save POST rejected — HTTP ${response.status()}: ${bodyText.slice(0, 300)}`
    ).toBeTruthy();

    // Envelope is `{ …, data: <application> }`; tolerate an already-unwrapped
    // body. The saved stakeholder must come back in `stakeholders`.
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      /* non-JSON body — the assertion below reports it */
    }
    const app = ((parsed as { data?: unknown } | null)?.data ?? parsed) as {
      stakeholders?: Array<{ email?: string }>;
    } | null;
    const persisted = !!app?.stakeholders?.some((s) => s.email === stakeholder.email);
    expect(
      persisted,
      `the save response did not include stakeholder "${stakeholder.email}" — ` +
        'the UI accepted it (optimistic fallback) but the server did not persist it'
    ).toBeTruthy();

    await this.page
      .locator(`#${STAKEHOLDER_FORM_ID}`)
      .waitFor({ state: 'hidden', timeout: 10_000 });
    await expect(
      this.page.getByRole('cell', { name: savedCell }).first(),
      'the saved stakeholder row should surface in the table'
    ).toBeVisible({ timeout: 15_000 });
  }

  // ── JSON-driven helpers ──────────────────────────────────────────────────
  //
  // Variants of the legacy fillers that accept `undefined` and silently skip.
  // The data-driven `fill*Tab(data)` branches below build on these so a JSON
  // config can omit any field and the form is simply left empty there — which
  // is the documented contract of these fixtures.

  /** Substitute every `{{unique}}` token in `s` with the module-load
   *  `UNIQUE_SUFFIX`. Identifying fields (`companyName`, `registrationNumber`,
   *  `identificationId`) need this so the dev backend doesn't reject a
   *  re-run for `ERR_AB_0022` (duplicate registration number / legal name). */
  private applyUnique(s: string | undefined): string | undefined {
    if (s === undefined) return undefined;
    return s.replace(/\{\{unique\}\}/g, UNIQUE_SUFFIX);
  }

  /** Fill `#id` with `value` — no-op when `value === undefined`. */
  private async fillIfPresent(id: string, value: string | undefined) {
    if (value === undefined) return;
    await this.fillInput(id, value);
  }

  /** Pick an option in a `Select` by **searching for the JSON value** rather
   *  than regex-matching the visible label. The `Select` portal carries a
   *  `Search…` input (`<input placeholder="Search…">`) that filters options
   *  by `label.toLowerCase().includes(q) || value.toLowerCase().includes(q)`
   *  — so typing the wire code (`"JP"`) narrows the menu to the matching row
   *  and a click of the first visible option lands the right value. When the
   *  menu has too few options to render the search input (`Select` shows
   *  search whenever options > 0, but `MultiSelect` only above 6 — see
   *  `multiSelectIfPresent`), this falls back to a case-insensitive label
   *  match so `"savings"` etc. still picks the right row.
   *
   *  No-op when `value === undefined`. */
  private async selectIfPresent(id: string, value: string | undefined) {
    if (value === undefined) return;
    const trigger = this.page.locator(`#${id}`);
    if (!(await trigger.isVisible().catch(() => false))) return;
    if (await trigger.isDisabled().catch(() => false)) return;
    await trigger.click();
    const portal = this.page.locator('[data-filter-portal="true"]').last();
    const search = portal.locator('input[placeholder="Search…"]');
    if (await search.isVisible().catch(() => false)) {
      await search.fill(value);
      // The list re-renders on every keystroke — click the first remaining
      // option button. (The portal's "Clear search" button has an
      // `aria-label`, not visible text, so a generic `button` locator could
      // hit it; scope to the options list by excluding the Clear button.)
      await portal
        .locator('button:not([aria-label="Clear search"])')
        .first()
        .click({ timeout: 5_000 })
        .catch(() => {
          log.warn('Select option not found via search', { field: id, value });
          return this.page.keyboard.press('Escape').catch(() => {});
        });
      return;
    }
    // Small menu: no search input → fall back to a substring label match.
    await portal
      .locator('button')
      .filter({ hasText: new RegExp(value, 'i') })
      .first()
      .click({ timeout: 5_000 })
      .catch(() => {
        log.warn('Select option not found via label match', { field: id, value });
        return this.page.keyboard.press('Escape').catch(() => {});
      });
  }

  /** Pick options in a `MultiSelect` by JSON value. Same search-first strategy
   *  as `selectIfPresent`: type the value into the portal's search input when
   *  present (filters on label OR value) and tick the first remaining row;
   *  otherwise fall back to a label substring match. The trigger is re-
   *  clicked after each pick to close the menu so its portal doesn't cover
   *  the field below. */
  private async multiSelectIfPresent(id: string, values: string[] | undefined) {
    if (!values || values.length === 0) return;
    const trigger = this.page.locator(`#${id}`);
    if (!(await trigger.isVisible().catch(() => false))) return;
    if (await trigger.isDisabled().catch(() => false)) return;
    for (const value of values) {
      await trigger.click();
      const portal = this.page.locator('[data-filter-portal="true"]').last();
      const search = portal.locator('input[placeholder="Search…"]');
      if (await search.isVisible().catch(() => false)) {
        await search.fill(value);
        await portal
          .locator('label')
          .first()
          .click({ timeout: 5_000 })
          .catch(() => log.warn('MultiSelect option not found via search', { field: id, value }));
      } else {
        await portal
          .locator('label')
          .filter({ hasText: new RegExp(value, 'i') })
          .first()
          .click({ timeout: 5_000 })
          .catch(() =>
            log.warn('MultiSelect option not found via label match', { field: id, value })
          );
      }
      // Close the menu before the next loop iteration / the next field.
      await trigger.click().catch(() => {});
    }
  }

  /** Drive a calendar date input from a `DateConfig`. `"today"` clicks the
   *  today cell; `{ yearsOffset }` uses the keyboard navigation that picks
   *  the 15th N years away. */
  private async pickDateIfPresent(id: string, date: DateConfig | undefined) {
    if (date === undefined) return;
    if (date === 'today') {
      await this.fillDateBestEffort(id);
      return;
    }
    await this.pickCalendarDate(id, date.yearsOffset);
  }

  /** Idempotent toggle/checkbox: drives only when the JSON explicitly
   *  asks for `true` (we don't un-tick something that's not set — fields
   *  default to off, so omitting the key matches "leave empty"). */
  private async toggleIfRequested(id: string, on: boolean | undefined) {
    if (on !== true) return;
    await this.toggleOn(id);
  }

  /** Phone input on the stakeholder drawer has no `#id` — it's matched by
   *  placeholder. Lifted out so the JSON path is symmetric with the other
   *  field helpers. */
  private async fillStakeholderPhoneIfPresent(value: string | undefined) {
    if (value === undefined) return;
    await this.page
      .getByPlaceholder(/enter phone number/i)
      .fill(value)
      .catch(() => {});
  }

  /** Fill the mailing address block based on the config branch:
   *   - `undefined` / `null` → tick "Same as above" (the otherwise-required
   *     mailing fields drop out of the step %).
   *   - object → leave the box unticked and fill the named fields literally
   *     (anything the object omits is still left empty). */
  private async fillMailingAddress(mailing: MailingAddressConfig | null | undefined) {
    if (!mailing) {
      await this.checkBox(/same as (above|mailing|business address)/i);
      return;
    }
    await this.selectIfPresent('mailCountry', mailing.mailCountry);
    await this.fillIfPresent('mailAddress', mailing.mailAddress);
    await this.fillIfPresent('mailPostcode', mailing.mailPostcode);
    await this.fillIfPresent('mailCity', mailing.mailCity);
  }

  /** JSON-driven Business Details (merchant variant). Mirrors the field set
   *  of `fillBusinessTab()` but fills only what the config supplies and skips
   *  document uploads entirely. Mailing block follows the
   *  `mailingAddress` rule (object → fill; null/omit → "same as above"). */
  private async fillBusinessTabFromConfig(data: MerchantBusinessConfig) {
    await this.selectIfPresent('companyType', data.companyType);
    await this.fillIfPresent('companyName', this.applyUnique(data.companyName));
    await this.fillIfPresent('registrationNumber', this.applyUnique(data.registrationNumber));
    await this.pickDateIfPresent('incorporationDate', data.incorporationDate);
    await this.fillIfPresent('registeredAddress', data.registeredAddress);
    await this.fillIfPresent('city', data.city);
    await this.fillIfPresent('postcode', data.postcode);
    await this.fillMailingAddress(data.mailingAddress);
    await this.fillIfPresent('doingBusinessAs', data.doingBusinessAs);
    await this.fillIfPresent('corporateWebsite', data.corporateWebsite);
  }

  /** JSON-driven partner Business Details — SOLE / company-particulars
   *  variant (anything that isn't Individual). Skips the regulatory-license
   *  toggle and all uploads. */
  private async fillPartnerCompanyParticularsFromConfig(data: PartnerBusinessConfig) {
    await this.selectIfPresent('companyType', data.companyType);
    await this.selectIfPresent('thirdPartyType', data.thirdPartyType);
    await this.fillIfPresent('companyName', this.applyUnique(data.companyName));
    await this.fillIfPresent('doingBusinessAs', data.doingBusinessAs);
    await this.fillIfPresent('registrationNumber', this.applyUnique(data.registrationNumber));
    await this.multiSelectIfPresent(
      'operationalCountry',
      data.operationalCountry ? [data.operationalCountry] : undefined
    );
    await this.selectIfPresent('natureOfBusiness', data.natureOfBusiness);
    await this.pickDateIfPresent('incorporationDate', data.incorporationDate);
    await this.fillIfPresent('postcode', data.postcode);
    await this.fillIfPresent('city', data.city);
    await this.fillIfPresent('registeredAddress', data.registeredAddress);
    await this.fillMailingAddress(data.mailingAddress);
  }

  /** JSON-driven partner Business Details — Individual variant. The phone
   *  input is non-schema (merged dial + number) and addressed by placeholder
   *  — the same one the stakeholder drawer uses, but there's only one phone
   *  field on this tab so it's unambiguous. */
  private async fillPartnerIndividualBusinessFromConfig(data: PartnerBusinessConfig) {
    await this.selectIfPresent('companyType', data.companyType);
    await this.selectIfPresent('thirdPartyType', data.thirdPartyType);
    await this.fillIfPresent('companyName', this.applyUnique(data.companyName));
    await this.pickDateIfPresent('indDob', data.indDob);
    await this.selectIfPresent('indNationality', data.indNationality);
    if (data.indPhoneNumber !== undefined) {
      await this.page
        .getByPlaceholder(/enter phone number/i)
        .first()
        .fill(data.indPhoneNumber)
        .catch(() => {});
    }
    await this.selectIfPresent('indIdentificationType', data.indIdentificationType);
    await this.pickDateIfPresent('indIdentificationIssuedDate', data.indIdentificationIssuedDate);
    await this.pickDateIfPresent('indIdentificationExpDate', data.indIdentificationExpDate);
    await this.fillIfPresent('registrationNumber', this.applyUnique(data.registrationNumber));
    await this.fillIfPresent('postcode', data.postcode);
    await this.fillIfPresent('city', data.city);
    await this.fillIfPresent('registeredAddress', data.registeredAddress);
    await this.fillMailingAddress(data.mailingAddress);
  }

  /** JSON-driven Stakeholder drawer fill. `primaryEmail` is the disabled +
   *  prefilled value to assert against on the seeded primary row; pass
   *  `undefined` to type into the (editable) email field for an Added
   *  stakeholder. */
  private async fillStakeholderDrawerFromConfig(
    data: StakeholderConfig,
    primaryEmail: string | undefined
  ) {
    await this.fillIfPresent('firstName', data.firstName);
    await this.fillIfPresent('middleName', data.middleName);
    await this.fillIfPresent('lastName', data.lastName);
    await this.pickDateIfPresent('dob', data.dob);
    await this.fillStakeholderPhoneIfPresent(data.phone);
    if (primaryEmail !== undefined) {
      await this.assertPrimaryEmailLocked(primaryEmail);
    } else {
      await this.fillIfPresent('email', data.email);
    }
    await this.selectIfPresent('nationality', data.nationality);
    if (data.ubo === true) {
      await this.checkBox(/ultimate beneficial owner/i);
      await this.page
        .locator('#ownershipPercentage')
        .waitFor({ state: 'visible', timeout: 5_000 })
        .catch(() => {});
      await this.fillIfPresent('ownershipPercentage', data.ownershipPercentage);
    }
    if (data.authorizedSignatory === true) {
      await this.checkBox(/authorized signatory/i);
    }
    await this.selectIfPresent('countryOfResidence', data.countryOfResidence);
    await this.fillIfPresent('postcode', data.postcode);
    await this.fillIfPresent('address', data.address);
    await this.fillIfPresent('city', data.city);
    await this.selectIfPresent('identificationType', data.identificationType);
    await this.fillIfPresent('identificationId', this.applyUnique(data.identificationId));
    await this.pickDateIfPresent('identificationIssuedDate', data.identificationIssuedDate);
    await this.pickDateIfPresent('identificationExpDate', data.identificationExpDate);
  }

  /** JSON-driven Payout Details. `paymentFrequency` is merchant-only — when
   *  the partner schema is active the field isn't on the tab and the helper
   *  silently skips it. Reuses the strict-select for `paymentFrequency` so a
   *  late schema-rebuild remount can't drop the value. */
  private async fillPayoutTabFromConfig(data: PayoutConfig) {
    await this.fillIfPresent('accountNumber', data.accountNumber);
    await this.selectIfPresent('accountType', data.accountType);
    await this.selectIfPresent('settlementCurrency', data.settlementCurrency);
    if (data.paymentFrequency !== undefined) {
      // Strict-select only when the trigger renders (merchant flow); the
      // partner schema hides it. Best-effort: fall back to soft select if
      // the strict path errors before commit.
      const trigger = this.page.locator('#paymentFrequency');
      if (await trigger.isVisible().catch(() => false)) {
        await this.selectOptionStrict('paymentFrequency', data.paymentFrequency).catch(() =>
          this.selectIfPresent('paymentFrequency', data.paymentFrequency)
        );
      }
    }
    await this.fillIfPresent('bankName', data.bankName);
    await this.fillIfPresent('bankCode', data.bankCode);
    await this.selectIfPresent('bankCountry', data.bankCountry);
    await this.fillIfPresent('branchCode', data.branchCode);
    await this.fillIfPresent('bankAccountName', data.bankAccountName);
  }

  /** JSON-driven Payment Methods. The five acceptance toggles are independent
   *  of the field section below — flip on whichever are explicitly `true`,
   *  then fill the product / settlement amounts that follow. */
  private async fillPaymentTabFromConfig(data: PaymentMethodsConfig) {
    await this.toggleIfRequested('hasHpp', data.hasHpp);
    await this.toggleIfRequested('hasServerApi', data.hasServerApi);
    await this.toggleIfRequested('hasQR', data.hasQR);
    await this.toggleIfRequested('hasPBL', data.hasPBL);
    await this.toggleIfRequested('hasRecurring', data.hasRecurring);
    await this.fillIfPresent('website', data.website);
    await this.fillIfPresent('describeProduct', data.describeProduct);
    await this.multiSelectIfPresent('transactionalCountries', data.transactionalCountries);
    await this.fillIfPresent('maximumTransactionAmount', data.maximumTransactionAmount);
    await this.fillIfPresent('averageTransactionAmount', data.averageTransactionAmount);
    await this.fillIfPresent('totalAnnualProjectionAmount', data.totalAnnualProjectionAmount);
  }
}
