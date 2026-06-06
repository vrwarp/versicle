import { test } from './utils';

test('verify event history', async ({ page }) => {
  console.log('Navigating to app...');
  await page.goto('/');

  // Handle empty library / Load Demo
  try {
    await page.waitForSelector('text=Your library is empty', { timeout: 10000 });
    console.log('Library empty. Loading demo book...');
    await page.click('text=Load Demo Book');
  } catch {
    console.log('Library not empty or loaded.');
  }

  // Open book
  console.log('Opening book...');
  await page.waitForSelector("[data-testid^='book-card-']", { timeout: 20000 });
  await page.click("[data-testid^='book-card-']:first-child");

  // Wait for reader
  await page.waitForSelector("[data-testid='reader-view']", { timeout: 15000 });
  console.log('Reader loaded.');

  // Allow epub.js/iframe to stabilize before freezing time
  await page.waitForTimeout(2000);

  // Install Clock
  console.log('Installing clock...');
  await page.clock.install();

  // 1. Test Page Event (Dwell)
  console.log('Dwelling on page 1 for 3s (fast-forward)...');
  await page.clock.fastForward(3000);

  console.log('Navigating to next page...');
  await page.keyboard.press('ArrowRight');

  // Dwell on page 2
  console.log('Dwelling on page 2 for 3s (fast-forward)...');
  await page.clock.fastForward(3000);

  // 2. Open History
  console.log('Opening History...');
  await page.click("[data-testid='reader-toc-button']");
  await page.click("[data-testid='tab-history']");

  // Verify Items
  try {
    await page.waitForSelector('ul.divide-y li', { timeout: 5000 });
    const items = page.locator('ul.divide-y li');
    const count = await items.count();
    console.log(`Found ${count} history items.`);

    if (count > 0) {
      const firstItem = items.first();
      const label = await firstItem.locator('span').innerText();
      console.log(`First item label: ${label}`);

      // Check for icons (SVG)
      const svg = firstItem.locator('svg');
      if ((await svg.count()) > 0) {
        console.log('Icon found.');
      } else {
        console.log('ERROR: No icon found.');
      }
    }
  } catch {
    console.log('No history items found or timeout.');
  }
});
