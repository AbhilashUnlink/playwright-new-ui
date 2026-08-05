import { expect } from '@playwright/test';
import type {
  ActionVisibility,
  TransactionDetailsPage,
} from '../pages/transactions/TransactionDetailsPage';
import type { TransactionDrawerPage } from '../pages/transactions/TransactionDrawerPage';
import type { ActionButton } from '../fixtures/test-config';
import { log } from './logger';

const ALL_ACTIONS: ActionButton[] = ['refund', 'capture', 'void', 'dispute', 'editStatus'];

/** Common assertions: visible buttons must be enabled; capture and void are mutually exclusive. */
async function assertSurface(
  surface: TransactionDetailsPage | TransactionDrawerPage,
  visibility: ActionVisibility,
  rowIndex: number,
  refId: string | null,
  surfaceLabel: 'drawer' | 'details'
) {
  for (const action of ALL_ACTIONS) {
    if (!visibility[action]) continue;
    const enabled = await surface.isActionEnabled(action);
    expect(
      enabled,
      `[${surfaceLabel}] Row #${rowIndex} (${refId}): "${action}" is visible but disabled`
    ).toBe(true);
  }

  if (visibility.capture && visibility.void) {
    throw new Error(
      `[${surfaceLabel}] Row #${rowIndex} (${refId}): capture AND void both visible — selector logic conflict`
    );
  }
}

export async function validateRowActions(
  detailsPage: TransactionDetailsPage,
  rowIndex: number,
  refId: string | null
): Promise<ActionVisibility> {
  const visibility = await detailsPage.getActionVisibility();
  log.info(`[details] Row #${rowIndex}`, { refId, ...visibility });
  await assertSurface(detailsPage, visibility, rowIndex, refId, 'details');
  return visibility;
}

export async function validateDrawerActions(
  drawer: TransactionDrawerPage,
  rowIndex: number,
  refId: string | null
): Promise<ActionVisibility> {
  const visibility = await drawer.getActionVisibility();
  log.info(`[drawer] Row #${rowIndex}`, { refId, ...visibility });
  await assertSurface(drawer, visibility, rowIndex, refId, 'drawer');
  return visibility;
}

/**
 * Drawer header and details page both consume `selectTransactionActions`.
 * Visibility must agree across surfaces — any divergence indicates a UI bug.
 */
export function assertSurfacesAgree(
  drawer: ActionVisibility,
  details: ActionVisibility,
  rowIndex: number,
  refId: string | null
) {
  const diffs = ALL_ACTIONS.filter((a) => drawer[a] !== details[a]);
  expect(
    diffs,
    `Row #${rowIndex} (${refId}): drawer vs details disagree on [${diffs.join(', ')}] — ` +
      `drawer=${JSON.stringify(drawer)}, details=${JSON.stringify(details)}`
  ).toEqual([]);
}
