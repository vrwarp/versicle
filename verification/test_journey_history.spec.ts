import { test, expect } from './utils';
import * as utils from './utils';

test('Reading History Journey Test', async ({ page }) => {
  // 1. Load the app (using the demo book since library might be empty)
  await page.goto('/');

  // Wait for either reader view, book cards, or empty library message
  for (let i = 0; i < 100; i++) {
    if (await page.isVisible("[data-testid='reader-view']")) {
      break;
    }
    if (await page.isVisible('text=Your library is empty')) {
      await page.click('text=Load Demo Book');
      await page.waitForSelector("[data-testid^='book-card-']", { timeout: 10000 });
      await page.click("[data-testid^='book-card-']:first-child");
      break;
    }
    if (await page.isVisible("[data-testid^='book-card-']")) {
      await page.click("[data-testid^='book-card-']:first-child");
      break;
    }
    await page.waitForTimeout(200);
  }

  // Wait for reader to load
  await page.waitForSelector("[data-testid='reader-view']", { timeout: 15000 });

  // DWELL TIME CHECK: We must stay on the initial page for > 2 seconds for history to track it
  await page.waitForTimeout(3000);

  // 2. Open Table of Contents
  await page.click("[data-testid='reader-toc-button']");

  // 3. Switch to History Tab
  await page.click("[data-testid='tab-history']");

  // 4. Navigate to a new chapter to generate history
  await page.click("[data-testid='tab-chapters']");
  await page.waitForSelector("[data-testid^='toc-item-']", { timeout: 5000 });

  // Click a different chapter than current to ensure navigation
  await page.click("[data-testid='toc-item-2']");

  // Wait for navigation to complete and wait for dwell time (2s)
  await page.waitForTimeout(3000);

  // 5. Check History again
  await page.click("[data-testid='reader-toc-button']");
  if (!(await page.isVisible("[data-testid='reader-toc-sidebar']"))) {
    await page.click("[data-testid='reader-toc-button']");
  }

  await page.click("[data-testid='tab-history']");

  // Should have at least one entry now.
  await expect(page.locator('ul.divide-y li')).not.toHaveCount(0, { timeout: 5000 });

  // Verify date is present
  const historyItem = page.locator('ul.divide-y li').first();
  const subLabel = await historyItem.locator('p.text-muted-foreground').innerText();
  expect(subLabel).toContain('•');

  // Take a screenshot for verification
  await page.screenshot({ path: 'verification/screenshots/history_with_date.png' });

  // 6. Click the history item to navigate back
  await historyItem.click();

  // Wait for navigation
  await page.waitForTimeout(2000);

  // Verify that the history panel (sidebar) is still open
  await expect(page.locator("[data-testid='reader-toc-sidebar']")).toBeVisible();

  console.log('Reading history journey completed successfully');
});
