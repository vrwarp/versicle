import { test, expect } from './utils';
import * as utils from './utils';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Drag and Drop Import Journey', async ({ page }) => {
  console.log('Starting Drag and Drop Import Journey...');
  await utils.resetApp(page);

  // 1. Verify Empty Library
  try {
    await expect(page.getByText('Updating Library')).not.toBeVisible({ timeout: 5000 });
  } catch {
    // If it wasn't visible, that's fine.
  }

  await expect(page.getByText('Your library is empty')).toBeVisible();
  await utils.captureScreenshot(page, 'drag_drop_1_empty');

  // 2. Drag and Drop a file
  const filePath = path.resolve(__dirname, 'alice.epub');
  const fileBuffer = Array.from(fs.readFileSync(filePath));

  console.log('Simulating drop...');
  await page.evaluate(([content, name]) => {
    const blob = new Blob([new Uint8Array(content)], { type: 'application/epub+zip' });
    const file = new File([blob], name, { type: 'application/epub+zip' });
    const dt = new DataTransfer();
    dt.items.add(file);

    const dropEvent = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt
    });

    const target = document.querySelector('[data-testid="library-view"]');
    if (target) {
      target.dispatchEvent(dropEvent);
    } else {
      throw new Error('Target not found');
    }
  }, [fileBuffer, 'alice.epub'] as [number[], string]);

  // 3. Verify Success Toast
  await expect(page.getByText('Book imported successfully')).toBeVisible({ timeout: 30000 });

  // 4. Verify Book Appears
  await expect(page.locator("[data-testid^='book-card-']").first()).toBeVisible();
  await utils.captureScreenshot(page, 'drag_drop_2_success');

  // 5. Drag invalid file
  console.log('Simulating invalid drop...');
  await page.evaluate(() => {
    const file = new File(['dummy'], 'test.pdf', { type: 'application/pdf' });
    const dt = new DataTransfer();
    dt.items.add(file);

    const dropEvent = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt
    });

    const target = document.querySelector('[data-testid="library-view"]');
    if (target) {
      target.dispatchEvent(dropEvent);
    }
  });

  // Verify Error Toast
  await expect(page.getByText('Only .epub files are supported')).toBeVisible();
  await utils.captureScreenshot(page, 'drag_drop_3_error');

  console.log('Drag and Drop Journey Passed!');
});
