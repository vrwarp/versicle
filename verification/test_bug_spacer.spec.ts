import { test, expect } from './utils';
import * as utils from './utils';

test('Spacer Bug Test', async ({ page }) => {
  console.log('Starting Spacer Bug Test...');
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  // 1. Open Book first time to set Scrolled Mode
  console.log('Opening book to set Scrolled Mode...');
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId('reader-back-button')).toBeVisible();
  await page.waitForTimeout(2000);

  // Enable Scrolled Mode
  const visualBtn = page.getByTestId('reader-visual-settings-button');
  await visualBtn.click();
  const scrolledTab = page.getByRole('tab', { name: 'Scrolled' });
  await scrolledTab.click();
  await page.waitForTimeout(1000);

  // Close settings (click outside)
  await page.mouse.click(10, 10);

  // Go back to library
  await page.getByTestId('reader-back-button').click();
  await expect(page.getByTestId('reader-back-button')).not.toBeVisible();

  // 2. Open Book again (Entering from library in Scrolled Mode)
  console.log('Opening book again (should be in Scrolled Mode)...');
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId('reader-back-button')).toBeVisible();

  // Wait for content to render
  await page.waitForTimeout(3000);

  // Locate the iframe
  const readerFrame = page.locator('[data-testid="reader-iframe-container"] iframe').contentFrame();

  // Check for spacer
  const spacer = readerFrame.locator('#reader-bottom-spacer');

  if ((await spacer.count()) > 0) {
    console.log('Spacer found!');
  } else {
    console.log('Spacer NOT found!');
  }

  await utils.captureScreenshot(page, 'spacer_bug_check');

  await expect(spacer).toHaveCount(1, { timeout: 5000 });
});
