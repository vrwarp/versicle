import { test, expect } from './utils';
import * as utils from './utils';

/**
 * Regression coverage for two Pronunciation Lexicon bugs:
 *
 *  1. Opening Settings from the reader used to navigate to the top-level
 *     /settings route, which renders SettingsShell OVER the library and
 *     unmounts the reader — clearing currentBookId, so the "This Book" lexicon
 *     scope vanished and a book-specific lexicon could not be added from there.
 *     Settings now nests under /read/:id/settings, keeping ReaderShell mounted
 *     so the book context (and the "This Book" tab) survives.
 *
 *  2. A per-rule "Lang" selection was dropped on save (handleSave omitted it),
 *     so it never persisted. It now round-trips through the store.
 */

test('Opening Settings from the reader keeps the "This Book" lexicon scope', async ({ page }) => {
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  // Open the book reader.
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page).toHaveURL(/.*\/read\/.*/, { timeout: 10000 });
  await utils.waitForReaderReady(page).catch(() => {});

  // Open Settings via the reader HEADER button (the previously-broken path).
  await page.getByTestId('reader-settings-button').click({ force: true });
  await expect(page.getByRole('tablist', { name: 'Settings sections' })).toBeVisible({ timeout: 10000 });
  // The overlay nests under the book — the reader stays mounted behind it.
  await expect(page).toHaveURL(/\/read\/.*\/settings/);
  await expect(page.getByTestId('reader-view')).toBeAttached();

  // Settings → Dictionary → Manage Rules.
  await utils.gotoSettingsTab(page, 'dictionary');
  await page.getByRole('button', { name: 'Manage Rules' }).click();
  await expect(page.getByRole('heading', { name: 'Pronunciation Lexicon', exact: true })).toBeVisible();

  // Both scopes are reachable — the regression is that "This Book" was missing.
  await expect(page.getByRole('tab', { name: 'Global' })).toBeVisible();
  const bookTab = page.getByRole('tab', { name: 'This Book' });
  await expect(bookTab).toBeVisible();

  // Activating it surfaces the per-book controls (Bible-pref group renders only
  // under book scope), proving the book-specific lexicon is live.
  await bookTab.click();
  await expect(bookTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('lexicon-pref-default')).toBeVisible();
});

test('A per-rule language selection persists across a dialog reopen', async ({ page }) => {
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page).toHaveURL(/.*\/read\/.*/, { timeout: 10000 });
  await utils.waitForReaderReady(page).catch(() => {});

  await page.getByTestId('reader-settings-button').click({ force: true });
  await expect(page.getByRole('tablist', { name: 'Settings sections' })).toBeVisible({ timeout: 10000 });
  await utils.gotoSettingsTab(page, 'dictionary');
  await page.getByRole('button', { name: 'Manage Rules' }).click();
  await expect(page.getByRole('heading', { name: 'Pronunciation Lexicon', exact: true })).toBeVisible();

  // Show all languages so a 'zh'-scoped rule is visible regardless of the
  // book's language (the toolbar filter defaults to the book language).
  await page.getByLabel('Filter by Language').selectOption('all');

  // Add a rule scoped to Chinese.
  await page.getByTestId('lexicon-add-rule-btn').click();
  await page.getByTestId('lexicon-input-original').fill('ChineseWord');
  await page.getByTestId('lexicon-input-replacement').fill('Replaced');
  await page.getByTestId('lexicon-rule-language-select').selectOption('zh');
  await page.getByTestId('lexicon-save-rule-btn').click();
  await expect(page.getByText('ChineseWord')).toBeVisible();

  await utils.waitForPersistedWrites(page);

  // Close and reopen the Lexicon Manager — it remounts and re-reads the store.
  await page.getByTestId('lexicon-close-btn').click();
  await page.getByRole('button', { name: 'Manage Rules' }).click();
  await page.getByLabel('Filter by Language').selectOption('all');

  // The saved language must come back when the rule is reopened for editing.
  await page.getByRole('button', { name: 'Edit rule' }).first().click();
  await expect(page.getByTestId('lexicon-rule-language-select')).toHaveValue('zh');
});
