import { test, expect } from "./utils";
import { captureScreenshot } from "./utils";

test("safe mode trigger", async ({ page, baseURL }) => {
  console.log("Starting Safe Mode Verification...");
  const finalBaseURL = baseURL || "http://localhost:5173";

  // Override indexedDB.open before the app loads
  await page.addInitScript(() => {
    const originalOpen = window.indexedDB.open.bind(window.indexedDB);
    window.indexedDB.open = function(...args) {
      if (args[0] === 'EpubLibraryDB') {
        throw new Error('Simulated DB Failure');
      }
      return originalOpen(...args);
    };
  });

  await page.goto(finalBaseURL);

  // Wait for Safe Mode screen
  try {
    await expect(page.getByRole("heading", { name: "Safe Mode" })).toBeVisible({ timeout: 5000 });
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
