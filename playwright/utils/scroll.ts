import type { Locator, Page } from '@playwright/test';
import { log } from './logger';

export interface InfiniteScrollOpts {
  /** Target row count to load before stopping. */
  targetCount: number;
  /** Locator that resolves to all currently rendered rows. */
  rowsLocator: Locator;
  /** Scrollable container; falls back to window scroll. */
  scrollContainer?: Locator;
  /** Step in px per scroll attempt. */
  stepPx?: number;
  /** ms to wait between scrolls for new rows to render. */
  settleMs?: number;
  /** Hard cap on scroll attempts. */
  maxAttempts?: number;
  /** Stop early if rendered count is unchanged for N consecutive attempts (end of data). */
  idleAttemptsBeforeStop?: number;
}

/**
 * Scrolls until the table has rendered at least `targetCount` rows.
 * Returns the actual number rendered (may be less if the data set is smaller).
 */
export async function scrollUntilRowCount(page: Page, opts: InfiniteScrollOpts): Promise<number> {
  const {
    targetCount,
    rowsLocator,
    scrollContainer,
    stepPx = 800,
    settleMs = 250,
    maxAttempts = 80,
    idleAttemptsBeforeStop = 4,
  } = opts;

  let lastCount = await rowsLocator.count();
  if (lastCount >= targetCount) return lastCount;

  let idleStreak = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (scrollContainer) {
      await scrollContainer.evaluate((el, step) => {
        el.scrollTop = el.scrollTop + step;
      }, stepPx);
    } else {
      await page.evaluate((step) => window.scrollBy(0, step), stepPx);
    }

    await page.waitForTimeout(settleMs);

    const current = await rowsLocator.count();

    if (current >= targetCount) {
      log.info(`Infinite scroll reached target`, { target: targetCount, rendered: current });
      return current;
    }

    if (current === lastCount) {
      idleStreak += 1;
      if (idleStreak >= idleAttemptsBeforeStop) {
        log.warn(`Infinite scroll exhausted (no more rows loading)`, {
          target: targetCount,
          rendered: current,
        });
        return current;
      }
    } else {
      idleStreak = 0;
      lastCount = current;
    }
  }

  log.warn(`Infinite scroll hit max attempts`, { target: targetCount, rendered: lastCount });
  return lastCount;
}
