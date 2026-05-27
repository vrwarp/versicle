import { test, expect } from "@playwright/test";
import { resetApp, captureScreenshot } from "./utils";

test("verify progress bar", async ({ page }) => {
  // 1. Reset app to ensure clean state
  await resetApp(page);

  // 2. Add the demo book (Alice in Wonderland)
  await page.waitForTimeout(2000);

  const demoBtn = page.getByText("Load Demo Book");
  if (await demoBtn.isVisible()) {
    await demoBtn.click();
    await expect(page.getByText("Alice's Adventures in Wonderland")).toBeVisible({ timeout: 15000 });
  }

  // 3. Simulate progress by navigating in the reader
  await page.getByText("Alice's Adventures in Wonderland").click();

  // Wait for reader container
  await page.waitForSelector('[data-testid="reader-iframe-container"]', { state: "attached", timeout: 5000 });

  // Wait for EPUB to render (sometimes takes a moment)
  await page.waitForTimeout(3000);

  // Advance pages to generate progress
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(500);
  }

  // Go back to library
  let backBtn = page.locator('button[aria-label="Back to Library"]');
  if (!(await backBtn.isVisible())) {
    backBtn = page.getByTestId("reader-back-button");
  }

  if (await backBtn.isVisible()) {
    await backBtn.click();
  } else {
    // Fallback: navigate via URL
    await page.goto("http://localhost:5173/");
  }

  // 4. Check for progress bar
  await page.waitForSelector('[data-testid^="book-card-"]', { timeout: 5000 });

  // Force reload to ensure library fetches latest book data if state wasn't updated
  await page.reload();
  await page.waitForSelector('[data-testid^="book-card-"]', { timeout: 5000 });

  // Verify progress bar is visible
  // We expect some progress > 0
  await expect(page.getByTestId("progress-bar")).toBeVisible();

  // 5. Capture screenshot
  await captureScreenshot(page, "library_progress_bar");
});
