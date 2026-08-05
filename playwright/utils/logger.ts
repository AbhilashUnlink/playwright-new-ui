export const log = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.log(`[E2E] ${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}`),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    console.warn(`[E2E][WARN] ${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}`),
  fail: (msg: string, meta?: Record<string, unknown>) =>
    console.error(`[E2E][FAIL] ${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}`),
};
