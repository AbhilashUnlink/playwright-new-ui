import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_URL } from './fixtures/test-config';
const ROOT = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: path.join(ROOT, 'tests'),
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(ROOT, 'reports', 'html'), open: 'never' }],
    ['junit', { outputFile: path.join(ROOT, 'reports', 'junit.xml') }],
  ],
  outputDir: path.join(ROOT, 'reports', 'artifacts'),
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      // Viewport widened from 1440 → 1680 so the right-anchored PBL Create
      // drawer (920px) + the secondary AddItemPanel (584px @ rightOffset 935)
      // both fit fully on screen. 1440px clips the secondary panel's left
      // edge, hiding the Product Name input and the "Add to Cart" footer.
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1680, height: 900 } },
    },
  ],
  // No webServer here: this folder holds only the e2e suite, not the app.
  // Start the app separately (npm start in the app repo) or point BASE_URL
  // at a deployed environment before running tests.
});
