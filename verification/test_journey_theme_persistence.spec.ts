import { test, expect } from "./utils";
import { resetApp, ensureLibraryWithBook, captureScreenshot } from "./utils";

test("theme persistence", async ({ page }) => {
  console.log("Starting Theme Persistence Journey...");
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open Book
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page).toHaveURL(/.*\/read\/.*/);
  await page.waitForTimeout(2000);

  // 1. Open Visual Settings
  console.log("Opening Visual Settings...");
  await page.getByTestId("reader-visual-settings-button").click();

  // 2. Select Dark Theme
  console.log("Selecting Dark Theme...");
  const darkBtn = page.locator('button[aria-label="Select Dark theme"]');
  await darkBtn.click();
  await page.waitForTimeout(1000);

  // Verify Dark Theme applied (html class)
  await expect(page.locator("html")).toHaveClass(/.*dark.*/);

  // Verify Button Active
  const isActive = await darkBtn.evaluate((el) => el.classList.contains("ring-2"));
  expect(isActive).toBe(true);

  await captureScreenshot(page, "theme_persistence_1_dark");

  // 3. Reload Page
  console.log("Reloading...");
  await page.reload();
  await page.waitForTimeout(2000);

  // 4. Verify Theme Persisted
  console.log("Verifying Theme Persistence...");
  await expect(page.locator("html")).toHaveClass(/.*dark.*/);

  // Open settings again to check button state
  await page.getByTestId("reader-visual-settings-button").click();
  const darkBtnReload = page.locator('button[aria-label="Select Dark theme"]');
  const isActiveReload = await darkBtnReload.evaluate((el) => el.classList.contains("ring-2"));
  expect(isActiveReload).toBe(true);

  await captureScreenshot(page, "theme_persistence_2_restored");

  console.log("Theme Persistence Journey Passed!");
});
