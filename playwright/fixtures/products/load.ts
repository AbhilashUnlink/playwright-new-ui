import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PblOrderConfig, SubscriptionConfig } from './types';

/**
 * JSON-fixture loader for the products / Pay-By-Link e2e. Kept out of the
 * spec body to mirror the `fixtures/onboarding/load.ts` shape — the spec
 * stays a plain Playwright test and the file-system plumbing lives here.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readJson<T>(relativePath: string): T {
  const absolute = path.resolve(__dirname, relativePath);
  return JSON.parse(readFileSync(absolute, 'utf-8')) as T;
}

export function loadPayByLinkConfig(): PblOrderConfig {
  return readJson<PblOrderConfig>('./pay-by-link.json');
}

export function loadSubscriptionConfig(): SubscriptionConfig {
  return readJson<SubscriptionConfig>('./subscription.json');
}
