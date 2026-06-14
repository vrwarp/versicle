import { test, expect } from './utils';
import * as utils from './utils';

test('ARIA Labels Verification', async ({ page }) => {
  console.log('Starting ARIA Labels Verification...');
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  // Open Book
  console.log('Opening book...');
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId('reader-view')).toBeVisible();

  // 1. Visual Settings ARIA Labels
  console.log('Verifying Visual Settings...');
  await page.getByLabel('Visual Settings').click({ force: true });

  // Font size slider
  await expect(page.getByLabel('Font size percentage')).toBeVisible();

  // Line height buttons
  await expect(page.getByLabel('Decrease line height')).toBeVisible();
  await expect(page.getByLabel('Increase line height')).toBeVisible();

  // Close Settings
  await page.getByTestId('visual-settings-close-button').click();

  // 2. Search ARIA Labels
  console.log('Verifying Search...');
  await page.getByLabel('Search').click();
  await expect(page.getByLabel('Search query')).toBeVisible();
  await expect(page.getByLabel('Close Side Bar')).toBeVisible();

  // Close Search via Back Button (which is now Close Side Bar)
  await page.getByLabel('Close Side Bar').click();

  // 3. Audio Panel ARIA Labels
  console.log('Verifying Audio Panel...');
  await page.getByLabel('Open Audio Deck').click();
  await expect(page.getByTestId('tts-panel')).toBeVisible();

  // Switch to the Settings view in the Audio Deck. The bare "Settings"
  // accessible name now matches the deck's footer toggle button
  // (tts-settings-tab-btn), which lives in the right-side Radix Sheet footer
  // below the fold — a plain click reports "outside of viewport". The shared
  // helper scrolls the footer button into view before clicking.
  await utils.switchAudioPanelView(page, 'settings');

  // Playback speed slider
  await expect(page.getByRole('slider', { name: 'Speed' })).toBeVisible();

  console.log('ARIA Labels Verification Passed!');
});
