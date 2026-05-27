import { test, expect } from './utils';
import * as utils from './utils';

test('Selection Popover Reappearance Test', async ({ page }) => {
  // Test that the selection popover (Compass Pill Annotation Mode) appears correctly after multiple selections,
  // specifically ensuring that adding a highlight doesn't break subsequent selection events.
  console.log('Starting Selection Bug Verification...');
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  // Open Book
  const bookCard = page.locator("[data-testid^='book-card-']").first();
  // Wait for book card to be visible before clicking
  await expect(bookCard).toBeVisible({ timeout: 5000 });
  await bookCard.click();

  await expect(page.getByTestId('reader-back-button')).toBeVisible({ timeout: 5000 });

  // Wait for iframe content
  const frame = page.locator('[data-testid="reader-iframe-container"] iframe').contentFrame();
  await frame.locator('body').waitFor({ timeout: 5000 });

  // Navigate to next page to ensure text content
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2000);

  // 1. First Selection & Highlight
  console.log('Step 1: First Selection & Highlight');
  await frame.locator('body').evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    while (node) {
      if (node.textContent && node.textContent.trim().length > 10) {
        break;
      }
      node = walker.nextNode();
    }

    if (node) {
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 10);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(
          new MouseEvent('mouseup', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: 100,
            clientY: 100
          })
        );
      }
    }
  });

  // Expect Compass Pill Annotation Mode to appear
  await expect(page.getByTestId('compass-pill-annotation')).toBeVisible({ timeout: 5000 });

  // Verify color button (yellow is used to verify action)
  const yellowButton = page.getByTestId('popover-color-yellow');
  await expect(yellowButton).toBeVisible();

  // Click highlight (yellow)
  await yellowButton.click();

  // Expect Annotation Mode to disappear
  await expect(page.getByTestId('compass-pill-annotation')).not.toBeVisible({ timeout: 5000 });

  // 2. Second Selection (Different text)
  console.log('Step 2: Second Selection');
  // We select a different range to simulate a new user interaction
  await frame.locator('body').evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    while (node) {
      if (node.textContent && node.textContent.trim().length > 30) {
        break;
      }
      node = walker.nextNode();
    }

    if (node) {
      const range = document.createRange();
      range.setStart(node, 15);
      range.setEnd(node, 25);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(
          new MouseEvent('mouseup', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: 150,
            clientY: 150
          })
        );
      }
    }
  });

  // Expect Compass Pill Annotation Mode to appear again
  await expect(page.getByTestId('compass-pill-annotation')).toBeVisible({ timeout: 5000 });

  console.log('Selection Bug Verification Passed!');
});
