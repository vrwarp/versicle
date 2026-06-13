import { test, expect } from './utils';
import * as utils from './utils';

test('Journey Lexicon CSV Import/Export', async ({ page }) => {
  // 1. Reset App and Open Settings
  await utils.resetApp(page);

  // Open Global Settings (Radix-Tabs SettingsShell): the Dictionary section is a
  // real tab (role="tab"); "Manage Rules" inside it opens the Lexicon Manager.
  await page.getByTestId('header-settings-button').click();
  await page.getByRole('tab', { name: 'Dictionary' }).click();
  await page.getByRole('button', { name: 'Manage Rules' }).click();

  await utils.captureScreenshot(page, 'lexicon_csv_01_initial_empty');

  // 2. Download Sample
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('lexicon-download-sample').click();
  const download = await downloadPromise;

  // Verify filename
  expect(download.suggestedFilename()).toBe('lexicon_sample.csv');

  // Save the downloaded file to a path so we can import it back
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();

  // 3. Import Sample CSV (using the downloaded file).
  // The import "replace existing rules?" prompt is now the in-app ConfirmDialog
  // (useConfirm in LexiconManager), not a native window.confirm — so the old
  // page.on('dialog', d => d.accept()) handler never fires. Upload the file,
  // then accept the in-app confirm to let the import proceed.
  await page.locator('input[data-testid="lexicon-import-input"]').setInputFiles(downloadPath!);
  await utils.acceptConfirm(page);

  // 4. Verify rules are added
  await expect(page.getByText('Dr.', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Doctor', { exact: true }).first()).toBeVisible();

  await expect(page.getByText('API', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('A.P.I.').first()).toBeVisible();

  await expect(page.getByText('cat|dog').first()).toBeVisible();
  await expect(page.getByText('pet').first()).toBeVisible();

  // Verify regex badge
  await expect(page.getByTestId('lexicon-regex-badge').first()).toBeVisible();

  await utils.captureScreenshot(page, 'lexicon_csv_02_imported');
});
