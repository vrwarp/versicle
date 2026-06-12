import { test, expect } from "./utils";
import { captureScreenshot, resetApp } from "./utils";

test("lexicon accessibility", async ({ page }) => {
  await resetApp(page);

  // 1. Open Settings
  await page.getByTestId("header-settings-button").click();

  // 2. Switch to Dictionary tab
  await page.getByRole("tab", { name: "Dictionary" }).click();

  // 3. Open Lexicon Manager
  await page.getByRole("button", { name: "Manage Rules" }).click();

  // Wait for dialog
  await expect(page.getByRole("dialog", { name: "Pronunciation Lexicon" })).toBeVisible();

  // 4. Click Add Rule
  await page.getByTestId("lexicon-add-rule-btn").click();

  // Verify Save/Cancel ARIA labels
  await expect(page.getByLabel("Save rule")).toBeVisible();
  await expect(page.getByLabel("Cancel adding")).toBeVisible();

  // Add a dummy rule to verify Move/Delete buttons
  await page.getByTestId("lexicon-input-original").fill("test");
  await page.getByTestId("lexicon-input-replacement").fill("pass");
  await page.getByLabel("Save rule").click();

  // Now verify the list item buttons
  await expect(page.getByLabel("Move rule up")).toBeVisible();
  await expect(page.getByLabel("Move rule down")).toBeVisible();
  await expect(page.getByLabel("Delete rule")).toBeVisible();

  // Also check the tabs
  await expect(page.getByRole("tab", { name: "Global" })).toBeVisible();

  // 5. Screenshot
  await captureScreenshot(page, "lexicon_manager");
  console.log("Verification screenshot saved!");
});
