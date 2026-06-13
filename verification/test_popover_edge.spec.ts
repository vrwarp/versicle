import { test, expect } from "./utils";
import type { FrameLocator } from "@playwright/test";
import { captureScreenshot, resetApp, ensureLibraryWithBook, navigateToChapter } from "./utils";

/**
 * Programmatically selects a real text node inside the epub.js iframe and fires
 * the `mouseup` the reader's selection bridge listens for
 * (src/domains/reader/engine/selectionBridge.ts). The annotation popover's CFI
 * is resolved via `contents.cfiFromRange(range)`, which only succeeds for a
 * range inside the rendered spine content — so we must select real prose, not a
 * synthetic node. Mirrors the proven approach in test_journey_notes.spec.ts /
 * test_bug_selection.spec.ts (page-level synthetic mouse drags do not reliably
 * create a selection inside the sandboxed iframe on WebKit).
 */
async function selectTextInFrame(frame: FrameLocator): Promise<boolean> {
  return frame.locator("body").evaluate(() => {
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      let node = walker.nextNode();
      while (node) {
        if (node.textContent && node.textContent.trim().length > 20) break;
        node = walker.nextNode();
      }
      if (!node) return false;

      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 15);
      const selection = window.getSelection();
      if (!selection) return false;
      selection.removeAllRanges();
      selection.addRange(range);

      // The reader keys off a real `mouseup` on the iframe document, then reads
      // window.getSelection(). Fire selectionchange first so WebKit commits the
      // selection, then mouseup to trigger the popover.
      document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
      document.dispatchEvent(
        new MouseEvent("mouseup", { view: window, bubbles: true, cancelable: true, clientX: 120, clientY: 120 })
      );
      return !selection.isCollapsed;
    } catch {
      return false;
    }
  });
}

test("popover edge collision", async ({ page }) => {
  console.log("Starting Selection Verification (formerly Edge Collision)...");

  // Set a mobile viewport
  await page.setViewportSize({ width: 375, height: 812 });

  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open Book
  const bookCard = page.locator("[data-testid^='book-card-']").first();
  await expect(bookCard).toBeVisible({ timeout: 5000 });
  await bookCard.click();

  await expect(page.getByTestId("reader-back-button")).toBeVisible({ timeout: 15000 });

  // Navigate to a content chapter via the TOC so we are guaranteed rendered
  // prose to select (front-matter pages reached by a single ArrowRight have no
  // selectable text on WebKit).
  await navigateToChapter(page, "toc-item-6");

  // Resolve the rendered content frame
  const frame = page.locator('[data-testid="reader-iframe-container"] iframe').contentFrame();
  await frame.locator("body").waitFor({ timeout: 10000 });

  console.log("Step 1: Selecting text");
  const selectionOk = await selectTextInFrame(frame);
  expect(selectionOk).toBeTruthy();

  // Expect Compass Pill Annotation Mode to appear
  const annotationPill = page.getByTestId("compass-pill-annotation");
  await expect(annotationPill).toBeVisible({ timeout: 5000 });

  // Verify buttons exist in the bar
  await expect(page.getByTestId("popover-copy-button")).toBeVisible();
  await expect(page.getByTestId("popover-add-note-button")).toBeVisible();

  await captureScreenshot(page, "annotation_pill_visible");
  console.log("Selection Verification Passed!");
});
