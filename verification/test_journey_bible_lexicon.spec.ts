import { test, expect } from './utils';
import * as utils from './utils';

test('Journey Bible Lexicon Test', async ({ page }) => {
  console.log('Starting Bible Lexicon Journey Verification...');
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  // 1. Open Global Settings from Library View
  console.log('Opening Global Settings...');
  await page.click("button[data-testid='header-settings-button']", { force: true });
  await expect(page.getByRole('dialog')).toBeVisible();

  // 2. Switch to Dictionary Tab (Radix-Tabs SettingsShell → real role="tab")
  console.log('Switching to Dictionary Tab...');
  await page.getByRole('tab', { name: 'Dictionary' }).click();

  // 3. Verify Bible Lexicon Global Toggle
  console.log('Verifying Global Toggle...');
  const bibleToggle = page.getByLabel('Enable Bible Abbreviations & Lexicon');
  await expect(bibleToggle).toBeVisible();

  // Ensure it's checked by default (based on implementation)
  await expect(bibleToggle).toBeChecked();

  await utils.captureScreenshot(page, 'bible_lexicon_global_settings');

  // Close settings
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();

  // 4. Open Book to check Per-Book Overrides
  console.log('Opening Book...');
  await page.getByText("Alice's Adventures in Wonderland").first().click();
  await expect(page).toHaveURL(/.*\/read\/.*/, { timeout: 10000 });

  // 5. Open the Lexicon Manager from the reader's Audio Deck.
  //
  // The per-book ("This Book") scope only renders while a book is the active
  // reader context (LexiconManager reads currentBookId from useReaderUIStore,
  // which the reader sets on mount and clears on unmount). The reader header's
  // settings button now navigates to the /settings route, which renders the
  // SettingsShell OVER the *library* (sibling route to /read/:id) — that
  // unmounts the reader and clears currentBookId, so the Lexicon Manager opened
  // from there shows only the "Global" scope. Open it instead from the Audio
  // Deck (a Sheet inside the reader), which keeps the book context alive so the
  // "This Book" override is reachable.
  console.log('Opening Audio Deck > Settings > Manage Pronunciation Rules...');
  await utils.openAudioSettings(page);
  await page.getByText('Manage Pronunciation Rules').click();

  // Wait for Lexicon Manager Dialog
  await expect(page.getByRole('heading', { name: 'Pronunciation Lexicon' })).toBeVisible();

  // 6. Switch to "This Book" scope (a real role="tab" in the Lexicon Scope tablist)
  console.log('Verifying Per-Book Controls...');
  await page.getByRole('tab', { name: 'This Book' }).click();

  // Verify Bible Preference Buttons (Default / On / Off)
  console.log('Verifying Preference Buttons...');
  await expect(page.getByTestId('lexicon-pref-default')).toBeVisible();
  await expect(page.getByTestId('lexicon-pref-on')).toBeVisible();
  await expect(page.getByTestId('lexicon-pref-off')).toBeVisible();

  // 7. Test Bible Lexicon OFF logic
  console.log('Testing Bible Lexicon OFF replacement...');
  await page.getByTestId('lexicon-pref-off').click();

  // Input test text
  await page.getByTestId('lexicon-test-input').fill('Matt. 5:15');

  // Click All Rules
  await page.getByTestId('lexicon-test-all-btn').click();

  // Expect NO replacement (Matt. -> Matt.) because Lexicon is OFF
  await expect(page.locator('text=Processed: Matt. 5:15')).toBeVisible();

  // 8. Test Bible Lexicon ON logic
  console.log('Testing Bible Lexicon ON replacement...');
  await page.getByTestId('lexicon-pref-on').click();

  // Click All Rules
  await page.getByTestId('lexicon-test-all-btn').click();

  // Expect replacement (Matt. -> Matthew) because Lexicon is ON
  await expect(page.locator('text=Processed: Matthew 5:15')).toBeVisible();

  await utils.captureScreenshot(page, 'bible_lexicon_book_override');
  console.log('Verification Complete.');
});
