export interface RetryOpts {
  attempts?: number;
  delayMs?: number;
  label?: string;
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const { attempts = 3, delayMs = 500, label = 'operation' } = opts;
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
  throw new Error(
    `Retry failed [${label}] after ${attempts} attempts: ${(lastErr as Error)?.message ?? lastErr}`
  );
}
