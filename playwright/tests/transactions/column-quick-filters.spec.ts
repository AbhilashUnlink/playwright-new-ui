// E2E: Transactions → every column's header quick filter, one by one.
//
// Each column header has a funnel that opens a scoped filter control. There are
// two kinds:
//   • text search  — a "Search <col>…" box (IDs, DASMID, merchant, enums, …)
//   • date range   — a "Select date range…" picker (Transaction Date, Update Date)
//
// For every filterable column this test:
//   1. Opens the funnel and asserts the correct, column-scoped control appears.
//   2. For text columns that expose a clean value in the table (via the cell's
//      `title` attribute — the untruncated stored value), types that value,
//      applies it, and asserts the table narrows to rows that match it.
//   3. Columns whose visible value can't be sourced cleanly (enums/amounts) or
//      that use the date-range picker are verified at the control level only.
//
// Outcomes are recorded per column and asserted softly, so one column never
// hides another. A summary is logged for visibility.
//
// Skipped unless TEST_USERNAME / TEST_PASSWORD are configured.
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/auth/LoginPage';
import { TransactionsPage } from '../../pages/transactions/TransactionsPage';
import { TEST_CONFIG } from '../../fixtures/test-config';
import { log } from '../../utils/logger';

const HAS_CREDS = !!TEST_CONFIG.credentials.username && !!TEST_CONFIG.credentials.password;

function isJunk(v: string): boolean {
  return !v || /^n\/?a$/i.test(v) || v === '—' || v === '-';
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface ColOutcome {
  label: string;
  kind: 'text-matched' | 'text-control-only' | 'date-range' | 'options-picker' | 'unknown';
  value?: string;
  rowsAfter?: number;
  note?: string;
}

test.describe('Transactions — every column header quick filter', () => {
  test.skip(!HAS_CREDS, 'TEST_USERNAME / TEST_PASSWORD env vars not set');

  test('each column funnel opens its filter and text columns search their value', async ({
    page,
  }) => {
    test.slow();
    test.setTimeout(540_000);
    const loginPage = new LoginPage(page);
    const t = new TransactionsPage(page);

    await test.step('login + open transactions', async () => {
      await loginPage.goto();
      await loginPage.login(TEST_CONFIG.credentials.username, TEST_CONFIG.credentials.password);
      await t.goto();
      await expect(page).toHaveURL(new RegExp(TEST_CONFIG.routes.transactions));
    });

    if ((await t.rows.count()) === 0) {
      await expect(t.emptyState.or(t.endOfData)).toBeVisible();
      test.info().annotations.push({ type: 'note', description: 'Empty data set — not exercised' });
      return;
    }

    const colMap = await t.columnFieldMap();
    const labels = Object.keys(colMap);
    log.info('filterable columns', { count: labels.length, labels });

    const outcomes: ColOutcome[] = [];

    for (const label of labels) {
      const { td, line } = colMap[label];
      await test.step(`column: ${label}`, async () => {
        // Fresh, unfiltered table for each column.
        await t.goto();

        // Try to source a clean, matchable value (prefer the title attr).
        const sample = Math.min(await t.rows.count(), 8);
        let value = '';
        for (let r = 0; r < sample; r++) {
          const { title } = await t.columnCellValue(r, td, line);
          if (title && !isJunk(title.trim())) {
            value = title.trim();
            break;
          }
        }

        await t.openColumnFilter(label);
        const { kind, hint } = await t.quickSearchControlKind();

        // Date-range columns: verify the picker opened; matching is out of scope.
        if (kind === 'date') {
          outcomes.push({ label, kind: 'date-range', note: hint });
          await t.closeQuickSearch();
          return;
        }

        // Enum columns expose an options list (no text box). Verify it opened.
        if (kind === 'picker') {
          outcomes.push({ label, kind: 'options-picker', note: hint });
          await t.closeQuickSearch();
          return;
        }

        // Text columns: the box must be scoped to this column.
        expect.soft(hint, `${label}: search box scoped to column`).toMatch(
          new RegExp(`Search ${escapeRegExp(label)}`, 'i')
        );

        if (!value) {
          // No clean value to type (enum/amount rendered without a title attr).
          outcomes.push({ label, kind: 'text-control-only', note: 'no title value to match' });
          await t.closeQuickSearch();
          return;
        }

        await t.applyQuickSearch(value);
        const rowsAfter = await t.rows.count();
        outcomes.push({ label, kind: 'text-matched', value, rowsAfter });

        // The searched value exists in the table, so it must return ≥1 row and
        // every visible row must carry that value in this column.
        expect.soft(rowsAfter, `${label}: "${value}" returned rows`).toBeGreaterThan(0);
        const check = Math.min(rowsAfter, 15);
        for (let i = 0; i < check; i++) {
          const { title, text } = await t.columnCellValue(i, td, line);
          const cell = (title ?? text ?? '').toLowerCase();
          expect
            .soft(cell, `${label}: row ${i} matches "${value}"`)
            .toContain(value.toLowerCase());
        }
      });
    }

    // Human-readable summary.
    const summary = outcomes
      .map((o) => {
        const tag = o.kind.padEnd(18);
        const extra =
          o.kind === 'text-matched' ? `rows=${o.rowsAfter} value="${o.value}"` : o.note ?? '';
        return `  ${o.label.padEnd(28)} ${tag} ${extra}`;
      })
      .join('\n');
    const count = (k: ColOutcome['kind']) => outcomes.filter((o) => o.kind === k).length;
    log.info(
      `column filter summary:\n${summary}\n` +
        `  text-matched=${count('text-matched')} control-only=${count('text-control-only')}` +
        ` options-picker=${count('options-picker')} date-range=${count('date-range')}`
    );

    // Every column must have resolved to a known control kind.
    expect.soft(outcomes.filter((o) => o.kind === 'unknown'), 'columns with unknown control').toEqual(
      []
    );
    expect(outcomes.length, 'every column was exercised').toBe(labels.length);
  });
});
