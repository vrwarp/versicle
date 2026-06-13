import { test, expect } from './utils';
import * as utils from './utils';

test('Abbreviation Settings Verification', async ({ page }) => {
  console.log('Starting Abbreviation Settings Verification...');
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  // Click the book to navigate to reader
  await page.getByText("Alice's Adventures in Wonderland").first().click();

  // Wait for navigation to reader
  await expect(page).toHaveURL(/.*\/read\/.*/, { timeout: 10000 });

  // 1. Open Global Settings
  console.log('Opening Global Settings...');
  await page.click("button[data-testid='reader-settings-button']", { force: true });
  await expect(page.getByRole('dialog')).toBeVisible();

  // 2. Switch to Dictionary Tab
  console.log('Switching to Dictionary Tab...');
  await page.getByRole('tab', { name: 'Dictionary' }).click();

  // 3. Verify TTS/Abbreviation settings are visible
  await expect(page.getByRole('heading', { name: 'Abbreviations', exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('heading', { name: 'Always Merge', exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('heading', { name: 'Sentence Starters', exact: true })).toBeVisible({ timeout: 5000 });

  // Check for Export/Import buttons (we have 3 sets now)
  await expect(page.locator("button[title='Download CSV']")).toHaveCount(3, { timeout: 5000 });
  await expect(page.locator("button[title='Upload CSV']")).toHaveCount(3, { timeout: 5000 });

  // Take screenshot of the settings panel
  await utils.captureScreenshot(page, 'abbrev_settings');
  console.log('Screenshot taken.');
});
