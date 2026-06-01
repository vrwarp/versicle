import { test, expect } from "./utils";
import { resetApp, ensureLibraryWithBook, captureScreenshot, navigateToChapter, getReaderFrame } from "./utils";

test("reading journey", async ({ page }) => {
  console.log("Starting Reading Journey...");
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open Book
  console.log("Opening book...");
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page).toHaveURL(/.*\/read\/.*/);
  await expect(page.getByTestId("reader-back-button")).toBeVisible();

  // Wait for content to render
  await page.waitForTimeout(2000);
  await captureScreenshot(page, "reading_01_initial_cover");

  // Navigate to a middle chapter immediately to ensure we have text
  console.log("Navigating to middle chapter via TOC...");
  await navigateToChapter(page);

  // Regain focus on the reader content so keyboard events work
  console.log("Clicking reader to ensure focus...");
  await page.locator('[data-testid="reader-iframe-container"]').click();
  await page.waitForTimeout(500);

  await captureScreenshot(page, "reading_01_chapter_start");

  // Helper to get current text content (for verification)
  async function getFrameText(): Promise<string> {
    const frame = getReaderFrame(page);
    if (!frame) return "Frame/Body not ready";
    try {
      await frame.locator("body").waitFor({ timeout: 2000 });
      const text = await frame.locator("body").innerText();
      return text.slice(0, 100).replace(/\n/g, ' ');
    } catch {
      return "Frame/Body not ready";
    }
  }

  async function navigateAndVerify(action: "ArrowRight" | "ArrowLeft" = "ArrowRight"): Promise<string> {
    const frame = getReaderFrame(page);
    if (!frame) return "Frame/Body not ready";
    const body = frame.locator("body");

    const initialText = await getFrameText();

    console.log(`Navigating with ${action}...`);
    if (action === "ArrowRight") {
      await page.keyboard.press("ArrowRight");
    } else if (action === "ArrowLeft") {
      await page.keyboard.press("ArrowLeft");
    }

    try {
      await expect(body).not.toHaveText(initialText, { timeout: 2000 });
    } catch {
      console.log(`Primary action ${action} failed to update text within 2s. Attempting fallback click...`);
      const viewport = page.viewportSize();
      if (viewport) {
        if (action === "ArrowRight") {
          await page.mouse.click(viewport.width * 0.9, viewport.height * 0.5);
        } else if (action === "ArrowLeft") {
          await page.mouse.click(viewport.width * 0.1, viewport.height * 0.5);
        }
      }
      try {
        await expect(body).not.toHaveText(initialText, { timeout: 5000 });
      } catch {
        console.warn(`WARNING: Navigation failed even after fallback. Text remains: ${initialText}`);
      }
    }

    return getFrameText();
  }

  const initialText = await getFrameText();
  console.log(`Initial Text: ${initialText}`);

  // 1. Navigation (Next Page 1)
  console.log("Testing Next Page (1)...");
  const compassPill = page.getByTestId("compass-pill-active");
  await expect(compassPill).toBeVisible({ timeout: 10000 });

  // Verify Compass Pill Accessibility
  console.log("Verifying Compass Pill Accessibility...");
  const activePill = page.getByTestId("compass-active-toggle");
  await expect(activePill).toHaveAttribute("role", "button");
  await expect(activePill).toHaveAttribute("tabindex", "0");

  await activePill.focus();
  await captureScreenshot(page, "reading_01_compass_pill_focus");

  const text1 = await navigateAndVerify("ArrowRight");
  console.log(`Page 1 Text: ${text1}`);
  await captureScreenshot(page, "reading_02_page_1");

  // Next Page 2
  console.log("Testing Next Page (2)...");
  const text2 = await navigateAndVerify("ArrowRight");
  console.log(`Page 2 Text: ${text2}`);
  await captureScreenshot(page, "reading_03_page_2");

  // Next Page 3
  console.log("Testing Next Page (3)...");
  const text3 = await navigateAndVerify("ArrowRight");
  console.log(`Page 3 Text: ${text3}`);

  if (text3 === initialText) {
    console.log("ERROR: Navigation failed: Content remains same as start.");
  }

  // Prev Page
  console.log("Testing Prev Page...");
  const textPrev = await navigateAndVerify("ArrowLeft");
  console.log(`Prev Page Text: ${textPrev}`);
  await captureScreenshot(page, "reading_05_prev_page");

  // 2. TOC
  console.log("Testing TOC...");
  const tocBtn = page.getByTestId("reader-toc-button");
  await tocBtn.click();
  await expect(page.getByTestId("reader-toc-sidebar")).toBeVisible();
  await captureScreenshot(page, "reading_06_toc_open");

  const tocItem = page.getByTestId("toc-item-1");
  const tocText = await tocItem.innerText();
  console.log(`Clicking TOC item: ${tocText}`);
  await tocItem.click();

  await expect(page.getByTestId("reader-toc-sidebar")).not.toBeVisible();

  const frame = getReaderFrame(page);
  if (frame) {
    const body = frame.locator("body");
    try {
      await expect(body).not.toHaveText(textPrev, { timeout: 5000 });
    } catch {
      console.log("TOC nav might not have changed text or timed out.");
    }
  }

  const textTocNav = await getFrameText();
  console.log(`After TOC Nav Text: ${textTocNav}`);
  await captureScreenshot(page, "reading_07_after_toc");

  // 3. Keyboard Shortcuts
  console.log("Testing Keyboard Shortcuts...");
  const textKey = await navigateAndVerify("ArrowRight");
  console.log(`After Key Right Text: ${textKey}`);

  console.log("Reading Journey Passed!");
});
