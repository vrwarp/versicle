import { test, expect } from './utils';
import type { FrameLocator } from '@playwright/test';
import * as utils from './utils';

/**
 * Programmatically selects text inside the epub.js iframe and fires the
 * `mouseup` event the reader listens for (see useEpubReader.ts attachListeners).
 * Mirrors the proven approach in test_journey_notes.spec.ts and works across
 * Chromium and WebKit, where Playwright's synthetic page-level mouse drag does
 * not reliably create a selection inside the (sandboxed, same-origin) iframe.
 *
 * @param skipNodes how many qualifying text nodes to skip, so successive calls
 *                  select visibly different text.
 */
async function selectTextInFrame(frame: FrameLocator, skipNodes: number): Promise<boolean> {
  return frame.locator('body').evaluate((_body, skip) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    let found = 0;
    while (node) {
      if (node.textContent && node.textContent.trim().length > 20) {
        if (found >= skip) break;
        found++;
      }
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
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    document.dispatchEvent(
      new MouseEvent('mouseup', { view: window, bubbles: true, cancelable: true, clientX: 120, clientY: 120 })
    );
    return !selection.isCollapsed;
  }, skipNodes);
}

test('Selection Popover Reappearance Test', async ({ page }) => {
  // Test that the selection popover (Compass Pill Annotation Mode) appears correctly after multiple selections,
  // specifically ensuring that adding a highlight doesn't break subsequent selection events.
  console.log('Starting Selection Bug Verification...');
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  // Open Book
  const bookCard = page.locator("[data-testid^='book-card-']").first();
  await expect(bookCard).toBeVisible({ timeout: 5000 });
  await bookCard.click();

  await expect(page.getByTestId('reader-back-button')).toBeVisible({ timeout: 5000 });

  // Navigate to a content chapter via the TOC so we are guaranteed rendered prose
  // to select (front-matter pages reached by a single ArrowRight have no text on WebKit).
  await utils.navigateToChapter(page, 'toc-item-6');

  // Resolve the rendered content frame
  const frame = page.locator('[data-testid="reader-iframe-container"] iframe').contentFrame();
  await frame.locator('body').waitFor({ timeout: 10000 });

  // 1. First Selection & Highlight
  console.log('Step 1: First Selection & Highlight');
  const ok1 = await selectTextInFrame(frame, 0);
  expect(ok1).toBeTruthy();

  // Expect Compass Pill Annotation Mode to appear
  await expect(page.getByTestId('compass-pill-annotation')).toBeVisible({ timeout: 15000 });

  // Verify color button (yellow is used to verify action)
  const yellowButton = page.getByTestId('popover-color-yellow');
  await expect(yellowButton).toBeVisible();

  // Click highlight (yellow)
  await yellowButton.click();

  // Expect Annotation Mode to disappear
  await expect(page.getByTestId('compass-pill-annotation')).not.toBeVisible({ timeout: 5000 });

  // 2. Second Selection (Different text) — verifies the popover reappears after a highlight
  console.log('Step 2: Second Selection');
  await page.waitForTimeout(500);

  const ok2 = await selectTextInFrame(frame, 2);
  expect(ok2).toBeTruthy();

  // Expect Compass Pill Annotation Mode to appear again
  await expect(page.getByTestId('compass-pill-annotation')).toBeVisible({ timeout: 15000 });

  console.log('Selection Bug Verification Passed!');
});
