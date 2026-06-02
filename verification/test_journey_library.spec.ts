import { test, expect } from './utils';
import * as utils from './utils';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Library Journey Test', async ({ page }) => {
  console.log('Starting Library Journey...');
  await utils.resetApp(page);

  // 1. Verify Empty Library
  await expect(page.getByText('Your library is empty')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Import an EPUB file')).toBeVisible({ timeout: 15000 });
  await utils.captureScreenshot(page, 'library_1_empty');

  // 2. Test "Load Demo Book"
  console.log('Testing Load Demo Book...');
  await page.getByText('Load Demo Book (Alice in Wonderland)').click();

  // Verify book appears
  const bookCard = page.locator("[data-testid^='book-card-']").first();
  await expect(bookCard).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Alice's Adventures in Wonderland").first()).toBeVisible({ timeout: 15000 });

  await utils.captureScreenshot(page, 'library_2_demo_loaded');

  // 3. Test Delete
  console.log('Testing Delete Book...');
  await bookCard.hover();
  await page.getByTestId('book-context-menu-trigger').click();
  await page.getByTestId('menu-delete').click();
  await page.getByTestId('confirm-delete').click();

  // Verify Empty Again
  await expect(bookCard).not.toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Your library is empty')).toBeVisible({ timeout: 15000 });
  await utils.captureScreenshot(page, 'library_3_deleted');

  // 4. Upload Book
  console.log('Uploading book...');
  const fileInput = page.getByTestId('hidden-file-input');
  await fileInput.setInputFiles(path.resolve(__dirname, 'alice.epub'));

  // Verify book appears
  await expect(page.locator("[data-testid^='book-card-']").first()).toBeVisible({ timeout: 15000 });
  await utils.captureScreenshot(page, 'library_4_uploaded');

  // 5. Persistence Check
  console.log('Reloading to check persistence...');
  await page.reload();
  await expect(page.locator("[data-testid^='book-card-']").first()).toBeVisible({ timeout: 15000 });

  // 6. Navigation Check (Clicking book)
  console.log('Clicking book to verify navigation...');
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page).toHaveURL(/.*\/read\/.*/);

  // Verify we are in reader view
  await expect(page.getByTestId('reader-back-button')).toBeVisible({ timeout: 15000 });
  await utils.captureScreenshot(page, 'library_5_reader_view');

  console.log('Library Journey Passed!');
});
