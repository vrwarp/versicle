import { test, expect } from "./utils";
import { captureScreenshot, resetApp } from "./utils";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("theme selection", async ({ page }) => {
  console.log("Starting Theme Verification...");
  await resetApp(page);

  // 1. Setup - Upload Book
  console.log("Uploading book...");
  const alicePath = path.resolve(__dirname, "alice.epub");
  const fileInput = page.getByTestId("hidden-file-input");
  await fileInput.setInputFiles(alicePath);
  await expect(page.locator("[data-testid^='book-card-']").first()).toBeVisible();

  // 2. Verify Light Theme (Default)
  const html = page.locator("html");
  await expect(html).toHaveClass(/\blight\b/);

  // Take screenshot
  await captureScreenshot(page, "theme_1_library_light");

  // 3. Open Settings
  console.log("Opening Settings...");
  await page.getByTestId("header-settings-button").click();
  await expect(page.getByText("Global Settings")).toBeVisible();

  // 4. Switch to Dark Theme
  console.log("Switching to Dark Theme...");
  await page.getByLabel("Select Dark theme").click();

  // Verify Dark Class
  await expect(html).toHaveClass(/\bdark\b/);
  await captureScreenshot(page, "theme_2_library_dark");

  // 5. Switch to Sepia Theme
  console.log("Switching to Sepia Theme...");
  await page.getByLabel("Select Sepia theme").click();

  // Verify Sepia Class
  await expect(html).toHaveClass(/\bsepia\b/);
  await captureScreenshot(page, "theme_3_library_sepia");

  // 6. Switch back to Light
  console.log("Switching to Light Theme...");
  await page.getByLabel("Select Light theme").click();
  await expect(html).toHaveClass(/\blight\b/);

  console.log("Theme Verification Passed!");
});
