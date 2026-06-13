import { test, expect } from "./utils";
import { captureScreenshot, resetApp } from "./utils";

test("verify bible toggle settings tab", async ({ page }) => {
  await resetApp(page);

  // Wait for settings button
  await expect(page.getByTestId("header-settings-button")).toBeVisible({ timeout: 15000 });

  // Open Settings
  await page.getByTestId("header-settings-button").click();

  // Wait for modal
  await expect(page.getByRole("dialog")).toBeVisible();

  // Go to Dictionary tab
  await page.getByRole("tab", { name: "Dictionary" }).scrollIntoViewIfNeeded().catch(() => {});
  await page.getByRole("tab", { name: "Dictionary" }).click();
  await page.waitForTimeout(1000);

  // Screenshot the Dictionary tab showing the new toggle
  await captureScreenshot(page, "bible_toggle");
});
