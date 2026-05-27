import { test, expect } from './utils';
import * as utils from './utils';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Import Error Journey Test', async ({ page }) => {
  console.log('Starting Import Error Journey...');
  await utils.resetApp(page);

  const dummyFile = path.resolve(__dirname, 'dummy.txt');
  try {
    // 1. Attempt to upload invalid file (text file)
    console.log('Uploading invalid file...');
    fs.writeFileSync(dummyFile, 'This is not an epub.');

    const fileInput = page.getByTestId('hidden-file-input');
    await fileInput.setInputFiles(dummyFile);

    // 2. Verify Error Message
    await page.waitForTimeout(1000);

    const errorMsg = page.locator('.text-destructive');

    if (await errorMsg.isVisible()) {
      console.log('Error message found: ' + (await errorMsg.innerText()));
      await utils.captureScreenshot(page, 'import_error_visible');
    } else {
      console.log('No error message visible. Verifying no book added.');
      await expect(page.locator("[data-testid^='book-card-']").first()).not.toBeVisible();
      await utils.captureScreenshot(page, 'import_error_prevented');
    }

    console.log('Import Error Journey Passed!');
  } finally {
    if (fs.existsSync(dummyFile)) {
      fs.unlinkSync(dummyFile);
    }
  }
});
