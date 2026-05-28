import { test, expect } from './utils';
import * as utils from './utils';

test('Journey Advanced Import Test', async ({ page }) => {
  // 1. Open App
  await page.goto('/');
  await expect(page.getByTestId('library-view')).toBeVisible();
  await utils.captureScreenshot(page, 'advanced_import_01_library_view');

  // 2. Open Global Settings
  await page.getByTestId('header-settings-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // Verify "General" tab is active (default) and shows Advanced Import options
  await expect(page.getByRole('heading', { name: 'Advanced Import' })).toBeVisible();

  const zipBtn = page.getByRole('button', { name: 'Import ZIP Archive' });
  const folderBtn = page.getByRole('button', { name: 'Import Folder' });

  await expect(zipBtn).toBeVisible();
  await expect(folderBtn).toBeVisible();

  await utils.captureScreenshot(page, 'advanced_import_02_settings_dialog');

  // 3. Simulate ZIP Upload (Verify input is wired up and triggers dialog)
  await expect(page.locator("input[type='file'][accept='.zip']")).toBeAttached();
  await expect(page.locator("input[type='file'][webkitdirectory]")).toBeAttached();

  const fileChooserPromise = page.waitForEvent('filechooser');
  await zipBtn.click();
  const fileChooser = await fileChooserPromise;
  expect(fileChooser).toBeTruthy();

  // Close settings
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await utils.captureScreenshot(page, 'advanced_import_03_closed_settings');
});
