import { test, expect } from "./utils";
import { resetApp, captureScreenshot } from "./utils";

test("lemonfox settings", async ({ page }) => {
  console.log("Starting LemonFox Settings Verification...");
  await resetApp(page);

  // Wait for library to load
  await page.waitForTimeout(1000);

  // Open Global Settings
  console.log("Opening Global Settings...");
  await page.getByTestId("header-settings-button").click();

  // Switch to TTS Engine tab
  console.log("Switching to TTS Engine tab...");
  await page.getByRole("tab", { name: "TTS Engine" }).scrollIntoViewIfNeeded().catch(() => {});
  await page.getByRole("tab", { name: "TTS Engine" }).click();

  // Verify we are on TTS tab
  await expect(page.getByText("Provider Configuration")).toBeVisible();

  // Open Provider dropdown
  console.log("Opening Provider dropdown...");
  await page.getByTestId("tts-provider-select").click();

  // Select LemonFox.ai
  console.log("Selecting LemonFox.ai...");
  await page.getByRole("option", { name: "LemonFox.ai" }).click();

  // Verify LemonFox API Key input appears
  console.log("Verifying LemonFox API Key input...");
  await expect(page.getByText("LemonFox API Key")).toBeVisible();

  // Verify input works
  const apiKeyInput = page.locator("input[type='password']").last();
  await apiKeyInput.fill("test-lemonfox-key");

  await captureScreenshot(page, "lemonfox_settings");

  console.log("LemonFox Settings Verification Passed!");
});
