// TEMP discovery spec (phase 2): for every filterable column, derive a live
// value from the table, apply its quick filter, and record the URL param +
// resulting rows + whether the value round-trips. Delete after use.
import { test } from '@playwright/test';
import { LoginPage } from '../../pages/auth/LoginPage';
import { TransactionsPage } from '../../pages/transactions/TransactionsPage';
import { TEST_CONFIG } from '../../fixtures/test-config';

test('discover column filters', async ({ page }) => {
  test.slow();
  test.setTimeout(300_000);
  const loginPage = new LoginPage(page);
  const transactions = new TransactionsPage(page);

  await loginPage.goto();
  await loginPage.login(TEST_CONFIG.credentials.username, TEST_CONFIG.credentials.password);
  await transactions.goto();

  // label -> {tdIndex, lineIndex} built from the header (th index === td index).
  const colMap: Record<string, { tdIndex: number; lineIndex: number }> = await page.evaluate(() => {
    const map: Record<string, { tdIndex: number; lineIndex: number }> = {};
    const ths = Array.from(document.querySelectorAll('table thead th'));
    ths.forEach((th, tdIndex) => {
      Array.from(th.querySelectorAll('button[data-column-search-trigger]')).forEach((b, lineIndex) => {
        const label = (b.getAttribute('aria-label') || '').replace(/^Filter\s+/, '');
        map[label] = { tdIndex, lineIndex };
      });
    });
    return map;
  });
  const labels = Object.keys(colMap);

  // Read a column's value from a specific rendered row (title attr preferred).
  async function readValue(rowIdx: number, tdIndex: number, lineIndex: number): Promise<string> {
    return page
      .locator('table tbody tr')
      .nth(rowIdx)
      .evaluate(
        (row, { tdIndex, lineIndex }) => {
          const td = row.querySelectorAll('td')[tdIndex] as HTMLElement | undefined;
          if (!td) return '';
          const titled = td.querySelectorAll('span[title]');
          if (titled[lineIndex]?.getAttribute('title')) return titled[lineIndex].getAttribute('title')!;
          const lineDivs = td.querySelectorAll(':scope > div > div');
          if (lineDivs[lineIndex]) return (lineDivs[lineIndex].textContent || '').trim();
          return (td.textContent || '').trim();
        },
        { tdIndex, lineIndex }
      );
  }

  const dialog = page.locator('[role="dialog"][aria-label="Search transactions"]');
  const results: any[] = [];
  for (const label of labels) {
    const { tdIndex, lineIndex } = colMap[label];
    try {
      // Fresh, unfiltered table each iteration (Escape first in case a prior
      // dialog stuck open, then a real navigation to drop any URL params).
      await page.keyboard.press('Escape').catch(() => {});
      await page.goto(TEST_CONFIG.routes.transactions, { waitUntil: 'domcontentloaded' });
      await transactions.rows.first().waitFor({ state: 'visible', timeout: 20_000 });
      const rowN = Math.min(await transactions.rows.count(), 6);

      // Find the first row with a usable (non-empty, non-N/A) value.
      let value = '';
      for (let r = 0; r < rowN; r++) {
        const v = (await readValue(r, tdIndex, lineIndex)).trim();
        if (v && !/^n\/?a$/i.test(v) && v !== '—' && v !== '-') {
          value = v;
          break;
        }
      }

      const trigger = page
        .locator(`button[data-column-search-trigger][aria-label="Filter ${label}"]`)
        .first();
      await trigger.scrollIntoViewIfNeeded({ timeout: 5000 });
      await trigger.click({ timeout: 5000 });
      await dialog.waitFor({ state: 'visible', timeout: 5000 });

      // What control does this column's filter expose?
      const textInputs = await dialog.locator('input[type="text"]').count();
      if (textInputs === 0) {
        // Non-text control (enum / date / numeric). Capture a compact snapshot.
        const snapshot = await dialog.evaluate((d) => {
          const kinds = new Set<string>();
          d.querySelectorAll('input,select,button,[role]').forEach((el) => {
            const role = el.getAttribute('role');
            const type = el.getAttribute('type');
            kinds.add(el.tagName.toLowerCase() + (role ? `[role=${role}]` : '') + (type ? `[type=${type}]` : ''));
          });
          const labels = Array.from(d.querySelectorAll('button,label,[role="option"]'))
            .map((e) => (e.textContent || '').trim())
            .filter(Boolean)
            .slice(0, 12);
          return { kinds: Array.from(kinds), labels };
        });
        results.push({ label, tdIndex, lineIndex, control: 'non-text', value, snapshot });
        continue;
      }

      const input = dialog.locator('input[type="text"]').first();
      const placeholder = await input.getAttribute('placeholder');
      if (!value) {
        results.push({ label, tdIndex, lineIndex, control: 'text', placeholder, skipped: 'no non-NA value' });
        continue;
      }
      await input.fill(value);
      await input.press('Enter');
      await page.waitForTimeout(1200);

      const url = new URL(page.url());
      const params = Object.fromEntries(url.searchParams.entries());
      const rowCount = await transactions.rows.count();
      const firstVal = rowCount > 0 ? (await readValue(0, tdIndex, lineIndex)).trim() : '';
      results.push({ label, tdIndex, lineIndex, control: 'text', placeholder, value, params, rowCount, firstVal });
    } catch (e) {
      results.push({ label, tdIndex, lineIndex, error: String(e).slice(0, 120) });
    }
  }
  console.log('\n===RESULTS===\n' + JSON.stringify(results, null, 1) + '\n===END_RESULTS===\n');
});
