import { test, expect } from "./utils";
import { resetApp, captureScreenshot, ensureLibraryWithBook, navigateToChapter } from "./utils";

test("verify progress bar", async ({ page }) => {
  // 1. Reset app to ensure clean state
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // 2. Open the book
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId("reader-back-button")).toBeVisible({ timeout: 10000 });

  // 3. Navigate to a mid-book chapter to generate meaningful progress
  // Chapter navigation fires the relocated event which saves progress
  await navigateToChapter(page, 'toc-item-6');

  // Wait for rendition and locations to be ready
  await page.waitForFunction("window.rendition && window.rendition.location").catch(() => {});
  await page.waitForFunction(
    "window.rendition && window.rendition.book && window.rendition.book.locations && window.rendition.book.locations.total() > 0",
    { timeout: 30000 }
  ).catch(() => {});
  await page.waitForTimeout(1000);

  // Navigate a few more pages to ensure non-zero progress percentage
  const viewport = page.viewportSize();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(800);
    if (viewport) {
      await page.mouse.click(viewport.width * 0.85, viewport.height * 0.5);
      await page.waitForTimeout(800);
    }
  }
  await page.waitForTimeout(1000);

  // Go back to library
  let backBtn = page.locator('button[aria-label="Back to Library"]');
  if (!(await backBtn.isVisible())) {
    backBtn = page.getByTestId("reader-back-button");
  }

  if (await backBtn.isVisible()) {
    await backBtn.click();
  } else {
    // Fallback: navigate via URL
    await page.goto("/");
  }

  // 4. Check for progress bar
  await page.waitForSelector('[data-testid^="book-card-"]', { timeout: 15000 });

  // Force reload to ensure library fetches latest book data if state wasn't updated
  await page.reload();
  await page.waitForSelector('[data-testid^="book-card-"]', { timeout: 15000 });

  // Verify progress bar is visible
  // We expect some progress > 0
  await expect(page.getByTestId("progress-bar")).toBeVisible();

  // 5. Capture screenshot
  await captureScreenshot(page, "library_progress_bar");
});
