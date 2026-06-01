import { Page } from '@playwright/test';
import { test, expect } from './utils';
import * as utils from './utils';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function uploadBook(page: Page, filename: string) {
  console.log(`Uploading ${filename}...`);
  const filePath = path.resolve(__dirname, filename);
  const fileBuffer = fs.readFileSync(filePath);
  const fileBase64 = fileBuffer.toString('base64');

  await page.evaluate(({ base64Data, filename }) => {
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const file = new File([byteArray], filename, { type: 'application/epub+zip' });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const dropEvent = new DragEvent('drop', { dataTransfer: dataTransfer, bubbles: true });
    document.querySelector('[data-testid="library-view"]')!.dispatchEvent(dropEvent);
  }, { base64Data: fileBase64, filename });

  // Small wait for ingestion to start
  await page.waitForTimeout(2000);
}

test('Language Scoped Font Profiles Test', async ({ page }) => {
  console.log('Starting Font Profiles Test...');
  await utils.resetApp(page);

  // 1. Upload English and Chinese Books
  await uploadBook(page, 'alice.epub');
  await uploadBook(page, 'test_chinese.epub');

  // Wait for both cards to appear
  const enBook = page.locator("[data-testid^='book-card-']", { hasText: "Alice's Adventures in Wonderland" }).first();
  const zhBook = page.locator("[data-testid^='book-card-']", { hasText: 'Test Chinese Book' }).first();

  await expect(enBook).toBeVisible({ timeout: 30000 });
  await expect(zhBook).toBeVisible({ timeout: 30000 });

  // 2. Open English Book and set size to 80%
  console.log('--- Phase 1: Setting English Profile ---');
  await enBook.click();
  await page.waitForSelector('iframe');

  await page.getByTestId('reader-visual-settings-button').click();
  await page.waitForSelector("[role='status']:has-text('%')");

  // Decrease to 80%
  while (!((await page.textContent("[role='status']:has-text('%')")) || '').includes('80%')) {
    await page.click("button[aria-label='Decrease font size']");
    await page.waitForTimeout(100);
  }

  await utils.captureScreenshot(page, 'font_profile_1_en_set_80');
  await page.getByTestId('visual-settings-close-button').click();
  await page.waitForTimeout(500);

  // 3. Return to Library and open Chinese Book
  console.log('--- Phase 2: Setting Chinese Profile ---');
  await page.getByTestId('reader-back-button').click();
  await page.waitForSelector("[data-testid='library-view']");

  await zhBook.click();
  await page.waitForSelector('iframe');

  await page.getByTestId('reader-visual-settings-button').click();
  await page.waitForSelector("[role='status']:has-text('%')");

  // 4. Ensure Book Language is set to Chinese
  const langSelect = page.getByTestId('book-language-select');
  if (!((await langSelect.innerText()) || '').includes('Chinese')) {
    console.log('Manually switching book language to Chinese...');
    await langSelect.click();
    await page.getByRole('option', { name: 'Chinese (zh)' }).click();
    await page.waitForTimeout(1000);
  }

  // 5. Verify Chinese font size is decoupled from English
  const zhSizeText = (await page.textContent("[role='status']:has-text('%')")) || '';
  console.log(`Chinese size (expected decoupled): ${zhSizeText}`);
  expect(zhSizeText.includes('80%')).toBeFalsy();

  // 6. Set Chinese font size to 150%
  while (!((await page.textContent("[role='status']:has-text('%')")) || '').includes('150%')) {
    await page.click("button[aria-label='Increase font size']");
    await page.waitForTimeout(100);
  }

  await utils.captureScreenshot(page, 'font_profile_2_zh_set_150');
  await page.getByTestId('visual-settings-close-button').click();
  await page.waitForTimeout(500);

  // 7. Final Persistence Verification
  console.log('--- Phase 3: Verifying Persistence ---');

  // Check English Book again
  await page.getByTestId('reader-back-button').click();
  await page.waitForSelector("[data-testid='library-view']");
  await enBook.click();
  await page.waitForSelector('iframe');

  await page.getByTestId('reader-visual-settings-button').click();
  const enFinalSize = (await page.textContent("[role='status']:has-text('%')")) || '';
  console.log(`Final English size: ${enFinalSize}`);
  expect(enFinalSize.includes('80%')).toBeTruthy();
  await page.getByTestId('visual-settings-close-button').click();

  // Check Chinese Book again
  await page.getByTestId('reader-back-button').click();
  await page.waitForSelector("[data-testid='library-view']");
  await zhBook.click();
  await page.waitForSelector('iframe');

  await page.getByTestId('reader-visual-settings-button').click();
  const zhFinalSize = (await page.textContent("[role='status']:has-text('%')")) || '';
  console.log(`Final Chinese size: ${zhFinalSize}`);
  expect(zhFinalSize.includes('150%')).toBeTruthy();

  await utils.captureScreenshot(page, 'font_profile_3_verified');
  console.log('Font Profiles Test Passed!');
});
