import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MerchantOnboardingConfig, PartnerOnboardingConfig, SignUpConfig } from './types';
import { TEST_CONFIG } from '../test-config';
import { GuestSignUpPage, type SignUpAccount } from '../../pages/onboarding/GuestSignUpPage';

/**
 * JSON-fixture loaders. Kept out of the specs themselves so the spec body
 * reads as a plain Playwright test and the file-system / JSON-parse plumbing
 * lives in one place. `readFileSync` over a JSON import deliberately — the
 * project's tsconfig set doesn't enable `resolveJsonModule`, and a runtime
 * read keeps the fixture editable without re-compiling.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readJson<T>(relativePath: string): T {
  const absolute = path.resolve(__dirname, relativePath);
  return JSON.parse(readFileSync(absolute, 'utf-8')) as T;
}

export function loadMerchantConfig(): MerchantOnboardingConfig {
  return readJson<MerchantOnboardingConfig>('./become-a-merchant.json');
}

export function loadPartnerConfig(): PartnerOnboardingConfig {
  return readJson<PartnerOnboardingConfig>('./become-a-partner.json');
}

/** Resolve a `SignUpConfig` (or absence thereof) into the inputs the
 *  `GuestSignUpPage.register*` flows need. Substitutes `{{unique}}` in the
 *  email with a per-call base-36 timestamp so re-runs never collide on
 *  "email already registered". Falls back to `TEST_CONFIG.credentials.password`
 *  / `TEST_CONFIG.otp` so a JSON that omits the secrets still runs in CI.
 *
 *  Returned `account.firstName` / `lastName` / `phone` carry hard defaults so
 *  the form has something to submit even when the JSON's `signUp` block is
 *  empty — every field on the public sign-up form is `required`, and a blank
 *  submit would simply error out client-side. */
export function resolveSignUp(signUp: SignUpConfig | undefined): {
  account: SignUpAccount;
  password: string;
  otp: string;
} {
  const su = signUp ?? {};
  const uniqueToken = Date.now().toString(36).toUpperCase();
  const rawEmail = su.email?.replace(/\{\{unique\}\}/g, uniqueToken);
  return {
    account: {
      firstName: su.firstName ?? 'PO',
      lastName: su.lastName ?? 'Tester',
      phone: su.phone ?? '9012345678',
      email: rawEmail && rawEmail.length > 0 ? rawEmail : GuestSignUpPage.uniqueEmail(),
      businessLocation: su.businessLocation,
      phoneCode: su.phoneCode,
    },
    password: su.password ?? TEST_CONFIG.credentials.password,
    otp: su.otp ?? TEST_CONFIG.otp,
  };
}
