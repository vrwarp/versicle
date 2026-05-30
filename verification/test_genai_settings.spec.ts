import { test, expect } from './utils';


test('Generative AI Settings Tab Test', async ({ page }) => {
  // 1. Open App
  await page.goto('/');

  // 2. Wait for Load
  await page.waitForTimeout(5000);

  // 3. Open Settings
  await page.getByLabel('Settings').first().click();

  // 4. Check for "Generative AI" tab
  const genaiTab = page.getByRole('button', { name: 'Generative AI' });
  await expect(genaiTab).toBeVisible();

  // 5. Click tab
  await genaiTab.click();

  // 6. Check for content
  await expect(page.getByText('Generative AI Configuration')).toBeVisible();
  await expect(page.getByLabel('Enable AI Features')).toBeVisible();

  // 7. Take screenshot
  await page.screenshot({ path: 'verification/screenshots/genai_settings.png' });
});
