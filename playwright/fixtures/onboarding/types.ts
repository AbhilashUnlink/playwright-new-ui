/**
 * JSON-driven onboarding fixtures — shape definitions.
 *
 * One config per flow (`become-a-merchant.json`, `become-a-partner.json`) is
 * loaded by a spec and passed straight into the matching `MerchantRegistrationPage`
 * tab helper. Every field is optional: anything the JSON omits is left empty
 * in the form (the page tabs save partial progress, so unfilled fields don't
 * block Next). File uploads are out of scope for now — they're driven by the
 * legacy hard-coded path and skipped entirely when a config is supplied.
 *
 * String values for selects are matched **case-insensitively as a regex
 * fragment** against the option's visible label (e.g. `"company limited"` →
 * matches the "Company Limited" trigger label). Use the EN label text from
 * `src/language/en/common.ts`.
 *
 * `{{unique}}` anywhere inside a string is substituted with a per-run base-36
 * timestamp so duplicate-rejection from the dev backend (`ERR_AB_0022`) doesn't
 * trip on re-runs. Use it on identifying fields — `companyName`,
 * `registrationNumber`, `identificationId`.
 */

/** Calendar date input — accepts either the literal `"today"` (clicks the
 *  today cell) or an integer years offset from today's month. The wizard's
 *  calendar inputs block keyboard typing, so the helper drives them via the
 *  same a11y shortcuts react-datepicker binds. */
export type DateConfig = 'today' | { yearsOffset: number };

/** Separate mailing address block. Omit or set `null` → the page object ticks
 *  "Same as above" and the mailing fields drop out of the step %. Provide an
 *  object → the helper fills the listed fields literally (leaves the box
 *  unticked, fills what's present). */
export interface MailingAddressConfig {
  mailCountry?: string;
  mailAddress?: string;
  mailPostcode?: string;
  mailCity?: string;
}

/** Business Details — merchant (GUEST) variant. */
export interface MerchantBusinessConfig {
  companyType?: string;
  companyName?: string;
  registrationNumber?: string;
  incorporationDate?: DateConfig;
  registeredAddress?: string;
  city?: string;
  postcode?: string;
  doingBusinessAs?: string;
  corporateWebsite?: string;
  mailingAddress?: MailingAddressConfig | null;
}

/** Business Details — partner (GUESTTHIRDPARTY) variant. Adds partner-only
 *  selects (thirdPartyType / operationalCountry / natureOfBusiness) and the
 *  full Individual identity block. `companyType` decides the layout: when it
 *  matches /individual/i the page object drives the identity block; otherwise
 *  the company-particulars block. */
export interface PartnerBusinessConfig {
  companyType?: string;
  thirdPartyType?: string;

  // Company-particulars (SOLE / PARTNER / PUBLIC / PRIVATE / STOCK / OTHER).
  companyName?: string;
  doingBusinessAs?: string;
  registrationNumber?: string;
  operationalCountry?: string;
  natureOfBusiness?: string;
  incorporationDate?: DateConfig;

  // Individual identity block (only when companyType === "Individual").
  indDob?: DateConfig;
  indNationality?: string;
  indPhoneNumber?: string;
  indIdentificationType?: string;
  indIdentificationIssuedDate?: DateConfig;
  indIdentificationExpDate?: DateConfig;

  // Address (shared).
  postcode?: string;
  city?: string;
  registeredAddress?: string;
  mailingAddress?: MailingAddressConfig | null;
}

/** Add/Edit Stakeholder drawer — single stakeholder per config (matches the
 *  current `StakeholderInput` interface in the POM). */
export interface StakeholderConfig {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  dob?: DateConfig;
  phone?: string;
  /** Editable only for an added (non-primary) stakeholder. The primary
   *  stakeholder's email is the account-creation email — seeded server-side
   *  and rendered disabled; the helper asserts it rather than typing. */
  email?: string;
  nationality?: string;
  ubo?: boolean;
  ownershipPercentage?: string;
  authorizedSignatory?: boolean;
  countryOfResidence?: string;
  postcode?: string;
  address?: string;
  city?: string;
  identificationType?: string;
  identificationId?: string;
  identificationIssuedDate?: DateConfig;
  identificationExpDate?: DateConfig;
}

/** Payout Details — `paymentFrequency` is merchant-only (partner schema hides
 *  it). A partner config can leave it `undefined` and the merchant helper
 *  silently skips it when the field isn't on the tab. */
export interface PayoutConfig {
  accountNumber?: string;
  accountType?: string;
  settlementCurrency?: string;
  paymentFrequency?: string;
  bankName?: string;
  bankCode?: string;
  bankCountry?: string;
  branchCode?: string;
  bankAccountName?: string;
}

/** Payment Methods — merchant-only step (partner wizard skips it). */
export interface PaymentMethodsConfig {
  hasHpp?: boolean;
  hasServerApi?: boolean;
  hasQR?: boolean;
  hasPBL?: boolean;
  hasRecurring?: boolean;
  website?: string;
  describeProduct?: string;
  transactionalCountries?: string[];
  maximumTransactionAmount?: string;
  averageTransactionAmount?: string;
  totalAnnualProjectionAmount?: string;
}

/** Public sign-up step that lands the new GUEST / GUESTTHIRDPARTY on
 *  `/onboarding`. Drives `/choose-account-type` → `/onboarding/sign-up`
 *  (account → OTP → password) before the wizard tabs begin.
 *
 *  Every field is optional with a runtime fallback:
 *   - `email` omitted → `GuestSignUpPage.uniqueEmail()` (per-run, never collides).
 *     When provided, `{{unique}}` is substituted with the module-load suffix.
 *   - `otp` omitted → `TEST_CONFIG.otp` (env-driven, dev backend default `1234`).
 *   - `password` omitted → `TEST_CONFIG.credentials.password` (env). Keeping it
 *     out of JSON in CI is the **recommended** posture; the field is here for
 *     local single-run experiments.
 *   - `businessLocation` / `phoneCode` omitted → the form's defaults (JP / +81).
 *     `businessLocation` is the country **label** (e.g. `"Japan"`), matched
 *     case-insensitively against the select's visible option text. */
export interface SignUpConfig {
  firstName?: string;
  lastName?: string;
  /** Country in the public sign-up's business-location select. Merchant
   *  accounts are restricted to JP/HK; Partner accounts see the full list. */
  businessLocation?: string;
  /** Dial code (e.g. `"+81"`). Normally auto-syncs from `businessLocation`,
   *  so most JSONs can omit it. */
  phoneCode?: string;
  phone?: string;
  email?: string;
  otp?: string;
  password?: string;
}

/** Top-level merchant flow config (`become-a-merchant.json`). */
export interface MerchantOnboardingConfig {
  signUp?: SignUpConfig;
  businessDetails?: MerchantBusinessConfig;
  stakeholder?: StakeholderConfig;
  payout?: PayoutConfig;
  paymentMethods?: PaymentMethodsConfig;
}

/** Top-level partner flow config (`become-a-partner.json`). No paymentMethods. */
export interface PartnerOnboardingConfig {
  signUp?: SignUpConfig;
  businessDetails?: PartnerBusinessConfig;
  stakeholder?: StakeholderConfig;
  payout?: PayoutConfig;
}
