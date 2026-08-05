// E2E: Finance → Statements filters, matched against the table output.
//
// For each filter TYPE we apply a filter and assert every visible row's
// corresponding column agrees with the filter. Values are derived from the
// live data where possible (read row 0, filter by it, assert all rows match)
// so the cases are non-empty and don't depend on a fixed seed.
//
//   - text        → Statement ID  (substring contains)
//   - multiSelect → DASMID         (exact equality)
//   - multiSelect → Statement Status
//   - select      → Recon Status   (only when a row has a concrete status)
//   - dateRange   → Statement Date (functional smoke — table re-fetches & loads)
//
// Skipped unless TEST_USERNAME / TEST_PASSWORD are configured (the signed-in
// user must also have visibility of statement data).
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/auth/LoginPage';
import { StatementsPage } from '../../pages/finance/StatementsPage';
import { TEST_CONFIG } from '../../fixtures/test-config';
import { log } from '../../utils/logger';

const HAS_CREDS = !!TEST_CONFIG.credentials.username && !!TEST_CONFIG.credentials.password;

// Displayed status pill text → its filter-option label (mirrors
// `statementStatusLabel` + STATEMENT_STATUS_OPTIONS in the app).
const STATUS_PILL_TO_OPTION: Record<string, RegExp> = {
  PENDING: /^pending$/i,
  APPROVED: /^approved$/i,
  CARRYFORWARD: /^carry forward$/i,
  'CF UNAPPROVED': /^cf unapproved$/i,
};

const COL = {
  statementId: /statement id/i,
  dasMid: /das\s*mid/i,
  statementStatus: /statement status/i,
  reconStatus: /recon status/i,
  statementDate: /statement date/i,
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('Statements — filters match the table output', () => {
  test.skip(!HAS_CREDS, 'TEST_USERNAME / TEST_PASSWORD env vars not set');

  test('every filter type narrows the table to matching rows', async ({ page }) => {
    test.slow();
    const loginPage = new LoginPage(page);
    const statements = new StatementsPage(page);

    await test.step('login + open statements', async () => {
      await loginPage.goto();
      await loginPage.login(TEST_CONFIG.credentials.username, TEST_CONFIG.credentials.password);
      await statements.goto();
      await expect(page).toHaveURL(new RegExp(TEST_CONFIG.routes.statements));
    });

    if ((await statements.rowCount()) === 0) {
      await expect(statements.emptyState.or(statements.endOfData)).toBeVisible();
      test
        .info()
        .annotations.push({ type: 'note', description: 'Empty data set — filters not exercised' });
      return;
    }

    // ── text: Statement ID substring ─────────────────────────────────────
    await test.step('text filter — Statement ID contains', async () => {
      // Use the full id, not a substring — the backend `StatementID` filter
      // isn't guaranteed to substring-match, and the full value always returns
      // at least its own row, so the case stays non-empty.
      const needle = (
        await statements.cellText(0, await statements.columnIndex(COL.statementId))
      ).replace(/\s+/g, '');
      expect(needle.length, 'row 0 has no usable Statement ID').toBeGreaterThan(0);

      await statements.openFilter();
      await statements.setRuleField(COL.statementId);
      await statements.setRuleText(needle);
      await statements.applyFilter();

      const ids = await statements.columnValues(COL.statementId);
      expect(ids.length, 'no rows after Statement ID filter').toBeGreaterThan(0);
      for (const id of ids) {
        expect(id.replace(/\s+/g, '').toLowerCase()).toContain(needle.toLowerCase());
      }
    });

    await statements.resetFiltersViaReload();

    // ── multiSelect: DASMID (exact) ──────────────────────────────────────
    await test.step('multiSelect filter — DASMID equals', async () => {
      const dasMid = await statements.cellText(0, await statements.columnIndex(COL.dasMid));
      expect(dasMid.length, 'row 0 has no DASMID').toBeGreaterThan(0);

      await statements.openFilter();
      await statements.setRuleField(COL.dasMid);
      await statements.setRuleMultiSelect([new RegExp(`^${escapeRegExp(dasMid)}$`)]);
      await statements.applyFilter();

      const values = await statements.columnValues(COL.dasMid);
      expect(values.length, 'no rows after DASMID filter').toBeGreaterThan(0);
      for (const v of values) expect(v).toBe(dasMid);
    });

    await statements.resetFiltersViaReload();

    // ── multiSelect: Statement Status ────────────────────────────────────
    await test.step('multiSelect filter — Statement Status', async () => {
      const pill = (
        await statements.cellText(0, await statements.columnIndex(COL.statementStatus))
      ).toUpperCase();
      const option = STATUS_PILL_TO_OPTION[pill];
      test.skip(!option, `row 0 status "${pill}" has no known filter option`);

      await statements.openFilter();
      await statements.setRuleField(COL.statementStatus);
      await statements.setRuleMultiSelect([option!]);
      await statements.applyFilter();

      const statuses = await statements.columnValues(COL.statementStatus);
      expect(statuses.length, 'no rows after Status filter').toBeGreaterThan(0);
      for (const s of statuses) expect(s.toUpperCase()).toBe(pill);
    });

    await statements.resetFiltersViaReload();

    // ── select: Recon Status (only when a concrete value exists) ─────────
    await test.step('select filter — Recon Status', async () => {
      const reconValues = await statements.columnValues(COL.reconStatus);
      const concrete = reconValues.find((v) => v && v !== '—' && v.toLowerCase() !== 'n/a');
      test.skip(!concrete, 'no row carries a concrete Recon Status to filter on');

      await statements.openFilter();
      await statements.setRuleField(COL.reconStatus);
      // The option label matches the displayed value case-insensitively.
      await statements.setRuleSelect(new RegExp(`^${escapeRegExp(concrete!)}$`, 'i'));
      await statements.applyFilter();

      const after = await statements.columnValues(COL.reconStatus);
      expect(after.length, 'no rows after Recon Status filter').toBeGreaterThan(0);
      for (const v of after) expect(v.toLowerCase()).toBe(concrete!.toLowerCase());
    });

    await statements.resetFiltersViaReload();

    // ── dateRange: Statement Date (functional smoke) ─────────────────────
    await test.step('dateRange filter — Statement Date re-fetches the table', async () => {
      const before = await statements.rowCount();
      await statements.openFilter();
      await statements.setRuleField(COL.statementDate);
      // A range that comfortably spans any real statement date.
      await statements.setRuleDateRange('2000-01-01', '2100-01-01');
      await statements.applyFilter();
      // A spanning range must not drop everything — exact in-range matching is
      // covered by the serializer unit tests (serializeForStatements).
      const after = await statements.rowCount();
      log.info('dateRange smoke', { before, after });
      expect(after, 'spanning date range returned no rows').toBeGreaterThan(0);
    });
  });
});
