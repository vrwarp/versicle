import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './verification',
  /* Maximum time one test can run for. */
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/reporters */
  reporter: 'dot',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`.
     * Default: https (local dev server via `npm run dev`).
     * Docker: run_verification.sh passes BASE_URL=http://localhost:5173 explicitly. */
    baseURL: process.env.BASE_URL ?? 'https://localhost:5173',
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    /* Browser launch options */
    launchOptions: {
      args: [
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--ignore-certificate-errors',
      ],
    },
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 375, height: 667 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 720 },
        launchOptions: {},
        serviceWorkers: 'block',
      },
      timeout: 180000,
      // WebKit reuses one long-lived browser instance per worker across the whole
      // run; that instance degrades over its ~25-test lifetime (memory/disk/IO),
      // which makes render-sensitive panels (e.g. the audio deck settings tab)
      // occasionally fail to paint within the wait. Extra retries absorb this
      // environmental flakiness — the tests themselves are deterministic in isolation.
      retries: 2,
    },
  ],
});
