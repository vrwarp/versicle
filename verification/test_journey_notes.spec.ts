import { test, expect } from './utils';
import * as utils from './utils';

test('Journey Notes Test', async ({ page }) => {
  console.log('Starting Global Notes Journey...');
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  // 1. Switch to Notes View
  console.log('Switching to Notes View...');
  await page.locator('button[aria-label="Select view context"]').click();
  await page.locator('div[role="option"]', { hasText: 'Notes' }).click();

  await expect(page.getByText('No annotations yet')).toBeVisible();
  await utils.captureScreenshot(page, 'notes_1_empty');

  // Switch back to Library
  await page.locator('button[aria-label="Select view context"]').click();
  await page.locator('div[role="option"]', { hasText: 'My Library' }).click();

  // 2. Open Book and Create Highlight
  console.log('Opening book and creating annotation...');
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId('reader-view')).toBeVisible({ timeout: 5000 });

  // Wait for iframe content
  const frame = page.locator('[data-testid="reader-iframe-container"] iframe').contentFrame();
  await frame.locator('body').waitFor({ timeout: 5000 });

  // Navigate to Chapter 5 via TOC to ensure we have content
  await utils.navigateToChapter(page);

  const selectTextFunction = (bodyEl: HTMLElement, skipCount: number) => {
    try {
      const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT, null);
      let node = walker.nextNode();
      let found = 0;
      while (node) {
        if (node.textContent && node.textContent.trim().length > 20) {
          if (found >= skipCount) {
            break;
          }
          found++;
        }
        node = walker.nextNode();
      }

      if (node) {
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, 15);
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }

        document.dispatchEvent(new MouseEvent('mouseup', {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100
        }));
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  };

  console.log('Creating Highlight...');
  const selectionSuccess = await frame.locator('body').evaluate(selectTextFunction, 0);
  expect(selectionSuccess).toBeTruthy();

  await expect(page.getByTestId('compass-pill-annotation')).toBeVisible({ timeout: 5000 });

  // Add a note
  await page.getByTestId('popover-add-note-button').click();
  await page.locator('textarea[placeholder="Add a note..."]').fill('This is my insightful note.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('compass-pill-annotation-edit')).not.toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('compass-pill-annotation')).not.toBeVisible({ timeout: 5000 });

  // 3. Go back to Library and Switch to Notes
  console.log('Returning to Library and viewing Notes...');
  await page.getByTestId('reader-back-button').click();

  // Wait for library
  await expect(page.locator('button[aria-label="Select view context"]')).toBeVisible({ timeout: 5000 });

  // Switch to notes
  await page.locator('button[aria-label="Select view context"]').click();
  await page.locator('div[role="option"]', { hasText: 'Notes' }).click();

  await expect(page.getByTestId('global-notes-view')).toBeVisible();

  // Check that book block is present
  await expect(page.locator("[data-testid='book-notes-block']")).toBeVisible();
  await expect(page.locator("[data-testid='book-notes-block']").getByText("Alice's Adventures in Wonderland").first()).toBeVisible();
  await expect(page.locator("[data-testid='book-notes-block']").getByText('This is my insightful note.').first()).toBeVisible();

  // Check search functionality
  console.log('Testing Search...');
  await page.getByTestId('notes-search-input').fill('nonexistent string 12345');
  await expect(page.getByText('No results found')).toBeVisible();

  // clear search
  await page.getByTestId('notes-search-input').fill('');

  // 4. Deep linking
  console.log('Testing deep linking...');

  // Click on the annotation card
  await page.locator("[data-testid^='annotation-card-']").first().click();

  // Verify we navigated back to reader
  await expect(page).toHaveURL(/.*\/read\/.*\?cfi=.*/);
  await expect(page.getByTestId('reader-view')).toBeVisible({ timeout: 5000 });

  await utils.captureScreenshot(page, 'notes_2_deep_link');
  console.log('Global Notes Journey Passed!');
});
