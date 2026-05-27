import { test, expect } from './utils';
import * as utils from './utils';

test('Compass Pill Journey', async ({ page }) => {
  console.log('Starting Compass Pill Journey...');

  // Clear local storage to ensure TTS queue is empty
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());

  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  // 1. Open Book
  console.log('Opening book...');
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page).toHaveURL(/.*\/read\/.*/);

  // 2. Simulate reading (navigate to a chapter)
  console.log('Navigating to chapter to ensure progress...');
  await page.getByTestId('reader-toc-button').click();
  await page.getByTestId('toc-item-2').click();
  await expect(page.getByTestId('reader-toc-sidebar')).not.toBeVisible();

  // Dwell time to ensure history recording logic (which requires > 2s duration)
  console.log('Reading (dwelling) for a few seconds...');
  await page.waitForTimeout(4000);

  // Move page slightly to trigger onLocationChange again
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2000);

  // 3. Go back to Library
  console.log('Going back to library...');
  await page.getByTestId('reader-back-button').click();
  await expect(page).toHaveURL(/.*\/$/);

  // Wait for library to load and update
  await page.waitForTimeout(2000);

  // 4. Check for Compass Pill
  console.log('Checking for Compass Pill...');
  const pill = page.getByTestId('compass-pill-summary');
  await expect(pill).toBeVisible();
  await expect(pill).toContainText('Continue Reading');
  await expect(pill).toContainText('% complete');

  await utils.captureScreenshot(page, 'compass_pill_visible');

  // 5. Click Compass Pill
  console.log('Clicking Compass Pill...');
  await pill.click();

  // 6. Verify returned to reader
  await expect(page).toHaveURL(/.*\/read\/.*/);
  await utils.captureScreenshot(page, 'compass_pill_clicked');

  console.log('Compass Pill Journey Passed!');
});
