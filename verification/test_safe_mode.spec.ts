import { test, expect } from "./utils";
import { captureScreenshot } from "./utils";

test("safe mode trigger", async ({ page, baseURL }) => {
  console.log("Starting Safe Mode Verification...");
  const finalBaseURL = baseURL || "http://localhost:5173";

  // Simulate a persistent IndexedDB failure for EpubLibraryDB before the app
  // loads, so boot's `db/open` task rejects and App routes to SafeModeView.
  await page.addInitScript(() => {
    const real = window.indexedDB;
    const originalOpen = real.open.bind(real);
    real.open = function (...args) {
      if (args[0] === 'EpubLibraryDB') {
        throw new Error('Simulated DB Failure');
      }
      return originalOpen(...args);
    };
    // WebKit's `window.indexedDB` is a getter that hands back a fresh
    // IDBFactory wrapper on repeated reads, so the `.open` override above is
    // dropped between connection.ts's open retries — the retry then hits a
    // clean native factory, succeeds, and the app boots normally instead of
    // entering Safe Mode. Pin the getter to this one patched factory so every
    // read (including idb's bare `indexedDB.open`) sees the override on all
    // three attempts. No-op on Chromium, which already returns a stable object.
    Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => real });
  });

  await page.goto(finalBaseURL);

  // Wait for Safe Mode screen
  try {
    await expect(page.getByRole("heading", { name: "Safe Mode" })).toBeVisible({ timeout: 20000 });
    console.log("Safe Mode screen visible.");
  } catch (e) {
    await captureScreenshot(page, "safe_mode_failure");
    throw e;
  }

  // Verify error message is displayed
  await expect(page.getByText("Simulated DB Failure").first()).toBeVisible();

  // Verify buttons
  await expect(page.getByRole("button", { name: "Try Again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset Database" })).toBeVisible();

  console.log("Safe Mode verification successful.");
});
