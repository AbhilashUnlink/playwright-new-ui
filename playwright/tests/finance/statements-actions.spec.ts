// E2E: Finance → Statements bulk + edit actions.
//
//   1. Approve        — select one eligible row, click APPROVE, assert the
//                       `approve-multiple` POST resolves 2xx.
//   2. Wired Status   — select one eligible row, click WIRED STATUS, assert the
//                       `update-wired-status` POST resolves 2xx.
//   3. Edit Status    — open a row's edit drawer, change STATUS to a valid
//                       transition, submit, assert the edit POST resolves 2xx.
//
// These MUTATE statement state on the target environment (intended — they
// automate the real actions). They are skipped unless creds are set, and each
// step self-skips (with an annotation) when the signed-in user lacks the
// permission or no eligible row exists, rather than failing.
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/auth/LoginPage';
import { StatementsPage } from '../../pages/finance/StatementsPage';
import { StatementEditDrawer } from '../../pages/finance/StatementEditDrawer';
import { TEST_CONFIG } from '../../fixtures/test-config';
import { log } from '../../utils/logger';

const HAS_CREDS = !!TEST_CONFIG.credentials.username && !!TEST_CONFIG.credentials.password;

function note(description: string) {
  test.info().annotations.push({ type: 'note', description });
}

test.describe('Statements — approve / wired-status / edit actions', () => {
  test.skip(!HAS_CREDS, 'TEST_USERNAME / TEST_PASSWORD env vars not set');

  test('drives Approve, Wired Status and Edit Status end-to-end', async ({ page }) => {
    test.slow();
    const loginPage = new LoginPage(page);
    const statements = new StatementsPage(page);
    const editDrawer = new StatementEditDrawer(page);

    await test.step('login + open statements', async () => {
      await loginPage.goto();
      await loginPage.login(TEST_CONFIG.credentials.username, TEST_CONFIG.credentials.password);
      await statements.goto();
      await expect(page).toHaveURL(new RegExp(TEST_CONFIG.routes.statements));
    });

    if ((await statements.rowCount()) === 0) {
      await expect(statements.emptyState.or(statements.endOfData)).toBeVisible();
      note('Empty data set — no actions exercised');
      return;
    }
    await statements.loadAtLeast(Math.min(TEST_CONFIG.statementCount, 40));

    // ── Approve ──────────────────────────────────────────────────────────
    await test.step('approve one eligible statement', async () => {
      if ((await statements.approveChip.count()) === 0) {
        note('APPROVE chip hidden — user lacks approve permission');
        return;
      }
      const idx = await statements.selectOneEligibleFor(statements.approveChip);
      if (idx < 0) {
        note('No approve-eligible (PENDING / CF-unapproved) row visible');
        return;
      }
      log.info('Approving statement row', { idx });
      await statements.approveSelected();
    });

    await statements.resetFiltersViaReload();
    await statements.loadAtLeast(Math.min(TEST_CONFIG.statementCount, 40));

    // ── Wired Status ─────────────────────────────────────────────────────
    await test.step('update wired status on one eligible statement', async () => {
      if ((await statements.wiredStatusChip.count()) === 0) {
        note('WIRED STATUS chip hidden — user lacks permission');
        return;
      }
      const idx = await statements.selectOneEligibleFor(statements.wiredStatusChip);
      if (idx < 0) {
        note('No wired-status-eligible (APPROVED + NOTPAID) row visible');
        return;
      }
      log.info('Updating wired status on row', { idx });
      await statements.updateWiredStatusSelected();
    });

    await statements.resetFiltersViaReload();
    await statements.loadAtLeast(Math.min(TEST_CONFIG.statementCount, 40));

    // ── Edit Status ──────────────────────────────────────────────────────
    await test.step('edit a statement status via the drawer', async () => {
      const total = await statements.rowCount();
      const maxTries = Math.min(total, 12);
      let edited = false;

      for (let i = 0; i < maxTries; i++) {
        await editDrawer.openDetailsFromRow(statements.rows.nth(i));
        // EDIT is disabled for regen-required (and permission-less) rows — don't
        // click it (that just hangs on Playwright's enabled wait). Once in the
        // form, STATUS itself is read-only for APPROVED / CARRYFORWARD, so guard
        // on that too before trying to change it.
        if (await editDrawer.editEnabled()) {
          await editDrawer.enterEdit();
          if (await editDrawer.isStatusEditable()) {
            const current = (await editDrawer.currentStatus()).toUpperCase();
            // CARRY FORWARD is a valid transition from both editable states
            // (PENDING and CARRYFORWARDUNAPPROVED) and is always different.
            expect(current).not.toBe('CARRY FORWARD');
            await editDrawer.setStatus(/carry forward/i);
            await editDrawer.submit();
            edited = true;
            break;
          }
        }
        // Not editable — dismiss the drawer and try the next row.
        await editDrawer.close();
      }

      if (!edited) note('No status-editable row found in the sampled rows');
    });
  });
});
