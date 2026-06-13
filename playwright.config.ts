import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './verification',
  /* Maximum time one test can run for.
   * 90s (was 30s): the multi-device sync journeys (two browser contexts, mock
   * Firestore, staged workspace switch with its own 60s in-test waits) legitimately
   * run >30s under full-suite parallel load. A real hang still fails — just later. */
  timeout: 90000,
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
        // Allow service workers (Playwright default). Blocking them made
        // navigator.serviceWorker.ready never resolve, so the app's
        // waitForServiceWorkerController() fell through to its 3s timeout on EVERY
        // page load (it gates the whole UI behind swInitialized). That added ~2s of
        // dead time per load on WebKit alone — the real reason WebKit looked slow.
        // With SWs allowed the SW registers + controls in ~10ms (parity with Chromium).
        serviceWorkers: 'allow',
      },
      // Slowest WebKit test under full parallel load is ~58s (the multi-device
      // seamless-handoff journey); 120s leaves ~2x headroom. This used to be 180s
      // to absorb the now-removed per-load 3s service-worker timeout (see above).
      timeout: 120000,
      // WebKit reuses one long-lived browser instance per worker across the whole
      // run; that instance degrades over its ~25-test lifetime (memory/disk/IO),
      // which makes render-sensitive panels (e.g. the audio deck settings tab)
      // occasionally fail to paint within the wait. Extra retries absorb this
      // environmental flakiness — the tests themselves are deterministic in isolation.
      // Full-suite runs keep WebKit parallel (for runtime), so these retries also absorb the
      // parallel-WebKit CPU/IO contention that intermittently lags a reader/library load.
      retries: 3,
    },
  ],
});
