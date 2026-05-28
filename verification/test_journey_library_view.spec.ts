import { test, expect } from './utils';
import * as utils from './utils';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Library Grid/List Toggle', async ({ page }) => {
  console.log('Starting Library Grid/List Toggle Journey...');

  // Set desktop viewport
  await page.setViewportSize({ width: 1280, height: 800 });
  await utils.resetApp(page);

  // 1. Upload first book (Alice)
  console.log('Uploading Alice...');
  const fileInput = page.getByTestId('hidden-file-input');
  await fileInput.setInputFiles(path.resolve(__dirname, 'alice.epub'));
  await expect(page.locator("[data-testid^='book-card-']").first()).toBeVisible({ timeout: 10000 });

  // 2. Upload second book (Frankenstein) to check multiple items
  console.log('Uploading Frankenstein...');
  await fileInput.setInputFiles(path.resolve(__dirname, 'frankenstein.epub'));

  // Increase timeout for second upload
  await expect(page.locator("[data-testid^='book-card-']")).toHaveCount(2, { timeout: 10000 });

  await utils.captureScreenshot(page, 'library_view_1_grid_initial');

  // 3. Check for Grid Layout (Default)
  const toggleBtn = page.getByTestId('view-toggle-button');
  await expect(toggleBtn).toBeVisible();
  // Expect Grid View (Button says "Switch to list view")
  await expect(toggleBtn).toHaveAttribute('aria-label', 'Switch to list view');
  await expect(page.locator("[data-testid^='book-card-']").first()).toBeVisible();

  // 4. Switch to List View
  console.log('Switching to List View...');
  await toggleBtn.click();

  // Verify List View
  await expect(toggleBtn).toHaveAttribute('aria-label', 'Switch to grid view');

  // Find Alice specifically
  const bookListItem = page.locator("[data-testid^='book-list-item-']").filter({ hasText: "Alice's Adventures in Wonderland" }).first();
  await expect(bookListItem).toBeVisible();

  // Verify Metadata in List Item
  await expect(bookListItem).toContainText('Lewis Carroll');
  await expect(bookListItem.locator('img')).toBeVisible();

  await utils.captureScreenshot(page, 'library_view_2_list_mode');

  // 5. Persistence Check
  console.log('Reloading to check persistence...');
  await page.reload();
  await expect(bookListItem).toBeVisible({ timeout: 5000 });
  await expect(toggleBtn).toHaveAttribute('aria-label', 'Switch to grid view');

  // 6. Switch back to Grid View
  console.log('Switching back to Grid View...');
  await toggleBtn.click();
  await expect(toggleBtn).toHaveAttribute('aria-label', 'Switch to list view');
  await expect(page.locator("[data-testid^='book-card-']").first()).toBeVisible();

  console.log('Library Grid/List Toggle Journey Passed!');
});

test('Mobile Library Grid Layout', async ({ page }) => {
  console.log('Starting Mobile Library Grid Layout Journey...');

  // Set mobile viewport (iPhone 12)
  await page.setViewportSize({ width: 390, height: 844 });

  await utils.resetApp(page);

  // 1. Ensure Library has a book
  await utils.ensureLibraryWithBook(page);
  const bookCard = page.locator("[data-testid^='book-card-']").first();
  await expect(bookCard).toBeVisible({ timeout: 5000 });

  await utils.captureScreenshot(page, 'mobile_library_grid_initial');

  // 2. Check for horizontal scroll
  const hasHorizontalScroll = await page.evaluate(() => {
    const container = document.querySelector('[data-testid="library-view"]');
    return container ? container.scrollWidth > container.clientWidth : false;
  });

  expect(hasHorizontalScroll).toBeFalsy();

  // 3. Check card width
  const cardBox = await bookCard.boundingBox();

  if (cardBox) {
    const width = cardBox.width;
    expect(width).toBeGreaterThanOrEqual(140);
    expect(width).toBeLessThan(200);
  } else {
    throw new Error('Card bounding box not found');
  }

  console.log('Mobile Library Grid Layout Journey Passed!');
});
