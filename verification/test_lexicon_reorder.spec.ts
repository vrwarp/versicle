import { test, expect } from "./utils";
import { resetApp } from "./utils";

test("lexicon reorder", async ({ page }) => {
  await resetApp(page);

  // Open Global Settings
  await page.getByTestId("header-settings-button").click();

  // Go to Dictionary tab
  await page.getByRole("tab", { name: "Dictionary" }).scrollIntoViewIfNeeded().catch(() => {});
  await page.getByRole("tab", { name: "Dictionary" }).click();

  // Open Manage Rules
  await page.getByRole("button", { name: "Manage Rules" }).click();

  // Add first rule: Apple -> A
  await page.getByTestId("lexicon-add-rule-btn").click();
  await page.getByTestId("lexicon-input-original").fill("Apple");
  await page.getByTestId("lexicon-input-replacement").fill("A");
  await page.getByTestId("lexicon-save-rule-btn").click();

  // Add second rule: Banana -> B
  await page.getByTestId("lexicon-add-rule-btn").click();
  await page.getByTestId("lexicon-input-original").fill("Banana");
  await page.getByTestId("lexicon-input-replacement").fill("B");
  await page.getByTestId("lexicon-save-rule-btn").click();

  // Verify initial order (Insertion order)
  // 1. Apple
  // 2. Banana
  const items = page.locator("[data-testid='lexicon-rules-list'] > div");
  await expect(items).toHaveCount(2);

  await expect(items.nth(0)).toContainText("Apple");
  await expect(items.nth(1)).toContainText("Banana");

  // Move Apple Down (Index 0)
  const btn = page.getByTestId("lexicon-move-down-0");
  await expect(btn).toBeVisible();
  await btn.click();

  // Verify new order (UI update)
  // 1. Banana
  // 2. Apple
  await expect(items.nth(0)).toContainText("Banana");
  await expect(items.nth(1)).toContainText("Apple");

  // Wait for persistence (IndexedDB async write)
  await page.waitForTimeout(1000);

  // Close Dialog
  await page.getByTestId("lexicon-close-btn").click();

  // Close Settings Modal (press Escape to ensure everything closes)
  await page.keyboard.press("Escape");

  // Wait for settings to close
  await page.waitForTimeout(500);

  // Reload page to verify persistence
  await page.reload();

  // Check again
  await page.getByTestId("header-settings-button").click();
  await page.getByRole("tab", { name: "Dictionary" }).scrollIntoViewIfNeeded().catch(() => {});
  await page.getByRole("tab", { name: "Dictionary" }).click();
  await page.getByRole("button", { name: "Manage Rules" }).click();

  const reloadedItems = page.locator("[data-testid='lexicon-rules-list'] > div");
  await expect(reloadedItems).toHaveCount(2);
  await expect(reloadedItems.nth(0)).toContainText("Banana");
  await expect(reloadedItems.nth(1)).toContainText("Apple");
});
