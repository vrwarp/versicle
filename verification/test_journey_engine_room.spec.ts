import { test, expect } from './utils';
import * as utils from './utils';

test('Engine Room Journey Test', async ({ page }) => {
  console.log('Starting Engine Room Journey...');
  await utils.resetApp(page);

  // 1. Test from Library
  console.log('Testing from Library...');
  await page.goto('/'); // Ensure at root
  // Wait for library to load
  await expect(page.getByText('My Library')).toBeVisible({ timeout: 5000 });

  const settingsBtn = page.getByTestId('header-settings-button');
  await expect(settingsBtn).toBeVisible();
  await settingsBtn.click({ force: true });

  // Verify the settings overlay (Radix Dialog) is open. The Phase-10 SettingsShell
  // renders as a Modal over the library; its tablist is the canonical anchor.
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Settings sections' })).toBeVisible({ timeout: 10000 });

  // The sidebar <h2>Settings</h2> is now aria-hidden; the real (sr-only) title is
  // "Global Settings". Assert the accessible tablist landmark instead of a heading.
  const viewport = page.viewportSize();
  if (viewport && viewport.width >= 640) {
    await expect(page.getByRole('tablist', { name: 'Settings sections' })).toBeVisible();
  }

  // Verify Tabs exist (Radix Tabs → role="tab", not role="button").
  await expect(page.getByRole('tab', { name: 'General' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'TTS Engine' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Dictionary' })).toBeVisible();

  // Check General Tab Content (default)
  await expect(page.getByRole('heading', { name: 'Advanced Import' })).toBeVisible();

  // Switch to TTS
  await page.getByRole('tab', { name: 'TTS Engine' }).click();
  await expect(page.getByText('Provider Configuration')).toBeVisible();
  await expect(page.getByText('Active Provider')).toBeVisible();

  // Close the overlay (closing is a history navigation back to the library).
  await page.getByTestId('settings-close-button').click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Settings sections' })).not.toBeVisible();

  // 2. Test from Reader
  console.log('Testing from Reader...');
  await utils.ensureLibraryWithBook(page);
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page).toHaveURL(/.*\/read\/.*/);
  await page.waitForTimeout(2000);

  // Click Settings (Gear) — nests Settings under /read/:id/settings (overlay
  // over the live reader, which stays mounted behind it).
  const readerSettingsBtn = page.getByTestId('reader-settings-button');
  await readerSettingsBtn.click({ force: true });

  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'General' })).toBeVisible();

  // Capture General Tab
  await utils.captureScreenshot(page, 'settings_01_general');

  // Capture Dictionary Tab
  await page.getByRole('tab', { name: 'Dictionary' }).click();
  await expect(page.getByText('Text Segmentation')).toBeVisible();
  await utils.captureScreenshot(page, 'settings_02_dictionary');

  // Capture Data Management Tab
  await page.getByRole('tab', { name: 'Data Management' }).click();
  await expect(page.getByText('Danger Zone')).toBeVisible();
  await utils.captureScreenshot(page, 'settings_03_data');

  // Capture TTS Tab
  await page.getByRole('tab', { name: 'TTS Engine' }).click();
  await expect(page.getByText('Provider Configuration')).toBeVisible();
  await utils.captureScreenshot(page, 'settings_04_tts');

  console.log('Engine Room Journey Passed!');
});
