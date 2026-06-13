import { test, expect } from "./utils";
import { resetApp, ensureLibraryWithBook, captureScreenshot, openAudioSettings } from "./utils";

test("settings persistence", async ({ page }) => {
  console.log("Starting Settings Persistence Journey...");
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open Book
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page).toHaveURL(/.*\/read\/.*/);
  await page.waitForTimeout(2000);

  // 1. Open Audio Panel and switch to its Settings view.
  // The audio deck is a right-side Radix Sheet; its "Settings" footer tab
  // (tts-settings-tab-btn) sits below the fold, so it must be scrolled into
  // view before clicking — openAudioSettings handles that.
  console.log("Opening Audio Panel...");
  await openAudioSettings(page);

  // 2. Toggle "Announce Chapter Titles" (Enable)
  console.log("Toggling Announce Chapter Titles (Enable)...");
  // Find the switch
  const switchLocator = page.getByText("Announce Chapter Titles", { exact: true }).locator("xpath=..").getByRole("switch");

  // Ensure it's visible
  await expect(switchLocator).toBeVisible();

  // Get current state
  const isChecked = (await switchLocator.getAttribute("aria-checked")) === "true";

  // Toggle it
  await switchLocator.click();
  await page.waitForTimeout(500);

  // Verify it flipped
  const expectedState = isChecked ? "false" : "true";
  await expect(switchLocator).toHaveAttribute("aria-checked", expectedState);

  await captureScreenshot(page, "settings_persistence_1_toggled");

  // 3. Reload
  console.log("Reloading...");
  await page.reload();
  await page.waitForTimeout(2000);

  // 4. Verify Persistence
  console.log("Verifying Persistence...");

  // Open Audio Panel again and switch back to its Settings view.
  await openAudioSettings(page);

  const finalSwitch = page.getByText("Announce Chapter Titles", { exact: true }).locator("xpath=..").getByRole("switch");
  await expect(finalSwitch).toHaveAttribute("aria-checked", expectedState);

  await captureScreenshot(page, "settings_persistence_2_restored");

  console.log("Settings Persistence Journey Passed!");
});
