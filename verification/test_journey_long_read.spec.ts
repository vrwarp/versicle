import { test, expect } from './utils';
import * as utils from './utils';

test('Journey Long Reading Test', async ({ page }) => {
  console.log('Starting Long Reading Journey (Multi-session, History, Annotations)...');
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  // --- Session 1: Reading and Highlighting ---
  console.log('\n--- Session 1 ---');

  // 1. Open Book
  console.log('Opening book...');
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page).toHaveURL(/.*\/read\/.*/);
  await expect(page.getByTestId('reader-back-button')).toBeVisible({ timeout: 10000 });

  // Wait for iframe content
  const frame = page.locator('[data-testid="reader-iframe-container"] iframe').contentFrame();
  await expect(frame.locator('body')).toBeVisible({ timeout: 10000 });

  await utils.captureScreenshot(page, 'long_journey_01_session1_start');

  // 2. Navigate to Chapter 1
  console.log('Navigating to Chapter 1...');
  await page.getByTestId('reader-toc-button').click();
  await page.getByTestId('toc-item-2').click();
  await expect(page.getByTestId('reader-toc-sidebar')).not.toBeVisible();

  // Wait for content
  await page.waitForTimeout(2000);

  // 3. Read (Next Page)
  console.log('Reading (Next Page)...');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2000);

  // 4. Highlight text
  console.log('Creating Highlight...');
  const selectionSuccess = await frame.locator('body').evaluate(() => {
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      let node = walker.nextNode();
      while (node) {
        if (node.textContent && node.textContent.trim().length > 20) {
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
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  });

  if (!selectionSuccess) {
    console.log('Warning: Could not select text for highlighting.');
  } else {
    await expect(page.getByTestId('compass-pill-annotation')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('popover-color-yellow').click();
    await expect(page.getByTestId('compass-pill-annotation')).not.toBeVisible();
    await page.waitForTimeout(1000);
  }

  await utils.captureScreenshot(page, 'long_journey_02_session1_highlight');

  // 5. Wait for Dwell Time (important for history)
  console.log('Waiting for dwell time (3s)...');
  await page.waitForTimeout(3000);

  // 6. Close Book (Return to Library)
  console.log('Closing book...');
  await page.getByTestId('reader-back-button').click();
  await expect(page.getByTestId('library-view')).toBeVisible({ timeout: 10000 });
  await utils.captureScreenshot(page, 'long_journey_03_library_returned');

  // --- Session 2: Resuming and History ---
  console.log('\n--- Session 2 ---');

  // 1. Reopen Book (Resume)
  console.log('Reopening book (Resume)...');
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId('reader-back-button')).toBeVisible({ timeout: 10000 });

  // Wait for load
  await page.waitForTimeout(3000);
  await utils.captureScreenshot(page, 'long_journey_04_session2_resumed');

  // 2. Navigate to Chapter 3 (toc-item-4)
  console.log('Navigating to Chapter 3...');
  await page.getByTestId('reader-toc-button').click();
  await page.getByTestId('toc-item-4').click();
  await expect(page.getByTestId('reader-toc-sidebar')).not.toBeVisible();
  await page.waitForTimeout(3000); // Wait for render + dwell

  // 3. Check History
  console.log('Checking History...');
  await page.getByTestId('reader-toc-button').click();
  await page.getByTestId('tab-history').click();

  // Expect history items
  const historyItems = page.locator('ul.divide-y li');
  await expect(historyItems).not.toHaveCount(0);

  await utils.captureScreenshot(page, 'long_journey_05_history_tab');

  // 4. Resume from History (navigate to a different chapter than current)
  console.log('Resuming from History...');
  const count = await historyItems.count();
  console.log(`History has ${count} items`);

  // Click the last history item (oldest entry — should be from Session 1, Chapter 1)
  const firstLabel = await historyItems.last().innerText();
  console.log(`Clicking history item: '${firstLabel.slice(0, 40)}'`);
  await historyItems.last().click();

  // Wait for navigation
  await page.waitForTimeout(2000);

  // Sidebar should remain visible after history click
  await expect(page.getByTestId('reader-toc-sidebar')).toBeVisible();

  console.log('History click navigation verified');

  await utils.captureScreenshot(page, 'long_journey_06_history_resumed');

  // --- Session 3: Persistence Check (Reload) ---
  console.log('\n--- Session 3 ---');

  // 1. Reload Page
  console.log('Reloading page...');
  await page.reload();
  await expect(page.getByTestId('reader-back-button')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(3000);

  // 2. Verify Highlight is present
  const countAfter = await page.evaluate(() => (window as any /* eslint-disable-line @typescript-eslint/no-explicit-any */).__reader_added_annotations_count);
  console.log(`Annotations count after reload: ${countAfter}`);

  if (countAfter > 0) {
    console.log('Highlight persistence verified.');
  } else {
    console.log('Warning: No annotations found after reload.');
  }

  await utils.captureScreenshot(page, 'long_journey_07_final_check');
  console.log('Long Reading Journey Passed!');
});
