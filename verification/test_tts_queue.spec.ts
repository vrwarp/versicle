import { test, expect } from './utils';
import * as utils from './utils';

test('TTS Queue Verification', async ({ page }) => {
  // Verifies that the TTS Queue UI is visible and populated.
  // Uses Next Page navigation to find text if initial page is empty.
  console.log('Resetting app...');
  await utils.resetApp(page);

  // Ensure book exists
  console.log('Ensuring book exists...');
  await utils.ensureLibraryWithBook(page);

  // Click on the first book (Alice in Wonderland)
  console.log('Opening book...');
  await page.locator("[data-testid^='book-card-']").first().click();

  // Wait for reader to load
  console.log('Waiting for reader...');
  await expect(page.getByTestId('reader-iframe-container')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2000);

  // Ensure audio button is visible before clicking (especially on mobile)
  const audioBtn = page.getByTestId('reader-audio-button');
  await audioBtn.waitFor({ state: 'visible', timeout: 10000 });

  // Open TTS Controls
  console.log('Opening TTS controls...');
  await audioBtn.click();

  // Wait for popup
  try {
    await expect(page.getByTestId('tts-panel')).toBeVisible({ timeout: 2000 });
  } catch {
    await page.getByTestId('reader-audio-button').click();
    await expect(page.getByTestId('tts-panel')).toBeVisible({ timeout: 2000 });
  }

  // Search for text by paging forward
  let foundText = false;
  const maxPages = 5;

  for (let i = 0; i < maxPages; i++) {
    console.log(`Checking page ${i + 1} for text...`);
    await page.waitForTimeout(2000);

    // Check queue status
    const queueItems = page.locator("[data-testid^='tts-queue-item-']");
    const count = await queueItems.count();

    if (count > 0) {
      console.log(`Found ${count} queue items.`);
      foundText = true;
      break;
    }

    console.log('Queue empty. Navigating to next page...');
    // Close TTS panel to allow navigation (avoid focus trap)
    await page.getByTestId('reader-audio-button').click();
    try {
      await expect(page.getByTestId('tts-panel')).not.toBeVisible({ timeout: 2000 });
    } catch {
      // Retry if click failed
      await page.getByTestId('reader-audio-button').click();
      await expect(page.getByTestId('tts-panel')).not.toBeVisible({ timeout: 2000 });
    }

    // Navigate
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(2000);

    // Re-open TTS panel
    await page.getByTestId('reader-audio-button').click();
    await expect(page.getByTestId('tts-panel')).toBeVisible({ timeout: 2000 });
  }

  if (!foundText) {
    // One last check
    if ((await page.locator("[data-testid^='tts-queue-item-']").count()) > 0) {
      console.log('Found items on last attempt.');
    } else {
      console.log('FAILURE: Could not find text after paging.');
      await utils.captureScreenshot(page, 'tts_queue_fail_paging');
      throw new Error('TTS Queue failed to populate after navigating through pages.');
    }
  }

  // Verify content
  const firstItem = page.locator("[data-testid^='tts-queue-item-']").first();
  console.log(`First item text: ${await firstItem.textContent()}`);

  await utils.captureScreenshot(page, 'tts_queue_verification');

  console.log('Test Passed: TTS Queue populated successfully.');
});
