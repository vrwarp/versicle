/**
 * Phase 8 §A/§B deep-link navigation journey (prep PR-4 exit criterion):
 *  - /settings/diagnostics cold-load opens the settings overlay on the
 *    Diagnostics panel OVER the library;
 *  - tab activation rewrites the URL (replace) and browser back closes the
 *    whole overlay in ONE step;
 *  - /notes is URL-addressable and the header context Select navigates
 *    (the synced `activeContext` preference died in §J).
 */
import { test, expect } from './utils';
import * as utils from './utils';

test('Journey Navigation: /settings and /notes deep links', async ({ page }) => {
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  // 1. Cold deep-link: /settings/diagnostics opens the overlay on Diagnostics.
  console.log('Deep-linking to /settings/diagnostics...');
  await page.goto('/settings/diagnostics');
  await expect(page.getByRole('tablist', { name: 'Settings sections' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('tab', { name: 'Diagnostics' })).toHaveAttribute('aria-selected', 'true');
  // The library renders UNDERNEATH the overlay (background surface).
  await expect(page.getByTestId('library-view')).toBeAttached();
  await utils.captureScreenshot(page, 'navigation_1_settings_deep_link');

  // 2. Tab switch is a replace-navigation: URL updates…
  await page.getByRole('tab', { name: 'Dictionary' }).click();
  await expect(page).toHaveURL(/\/settings\/dictionary$/);
  await expect(page.getByText('Pronunciation Lexicon')).toBeVisible();

  // …and the close button drops the overlay back to the library.
  await page.getByTestId('settings-close-button').click();
  await expect(page.getByRole('tablist', { name: 'Settings sections' })).not.toBeVisible();
  await expect(page.getByTestId('library-view')).toBeVisible();

  // 3. In-app open from the library header, then browser BACK closes it.
  console.log('Opening settings in-app and closing via browser back...');
  await page.getByTestId('header-settings-button').click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page.getByRole('tablist', { name: 'Settings sections' })).not.toBeVisible();
  await expect(page.getByTestId('library-view')).toBeVisible();

  // 4. /notes deep link renders the notes context; the Select navigates back.
  console.log('Deep-linking to /notes...');
  await page.goto('/notes');
  await expect(page.getByText('No annotations yet')).toBeVisible({ timeout: 10000 });
  await utils.captureScreenshot(page, 'navigation_2_notes_deep_link');

  await page.locator('button[aria-label="Select view context"]').click();
  await page.locator('div[role="option"]', { hasText: 'My Library' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[data-testid^='book-card-']").first()).toBeVisible();

  console.log('Navigation journey passed!');
});
