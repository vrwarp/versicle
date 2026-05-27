import { test, expect } from './utils';
import * as utils from './utils';

test('Iframe Height Verification', async ({ page }) => {
  // Verifies that the reader iframe container is reduced in height in paginated mode
  // to accommodate the bottom navigation pill.
  console.log('Starting Iframe Height Verification...');
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  // Open Book
  console.log('Opening book...');
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page).toHaveURL(/.*\/read\/.*/);

  // Wait for reader to be ready
  await page.waitForTimeout(3000);

  // Get the container element
  const container = page.locator('[data-testid="reader-iframe-container"]');
  await expect(container).toBeVisible();

  // Get the bounding box of the container
  const box = await container.boundingBox();
  if (!box) {
    throw new Error('Container not found or not visible');
  }

  const containerHeight = box.height;

  // Get the viewport height
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error('Viewport size not available');
  }
  const viewportHeight = viewport.height;

  console.log(`Container height: ${containerHeight}`);
  console.log(`Viewport height: ${viewportHeight}`);

  const diff = viewportHeight - containerHeight;
  console.log(`Difference (Viewport - Container): ${diff}`);

  // The container should be reduced by ~100px plus the header height (~50px).
  // Total difference should be around 150px.
  // We use a threshold of 140px to be safe.
  expect(diff).toBeGreaterThanOrEqual(140);

  // Capture screenshot to see the pill overlap
  await utils.captureScreenshot(page, 'iframe_height_check');
});
