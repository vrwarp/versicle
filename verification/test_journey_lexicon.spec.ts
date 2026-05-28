import { test, expect } from './utils';
import * as utils from './utils';

test('Journey Lexicon Test', async ({ page }) => {
  console.log('Starting Lexicon Journey...');
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  // Open Book
  console.log('Opening book...');
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page).toHaveURL(/.*\/read\/.*/);

  // Wait for book to load
  await page.waitForTimeout(2000);

  // Open Audio Deck
  console.log('Opening Audio Deck...');
  await page.getByTestId('reader-audio-button').click();

  // Switch to Settings
  await page.getByRole('button', { name: 'Settings' }).click({ force: true });

  // Open Lexicon Manager
  console.log('Opening Pronunciation Lexicon...');
  await page.getByText('Manage Pronunciation Rules').click();

  // Verify Dialog is open
  console.log('Verifying Dialog visibility...');
  await expect(page.getByRole('heading', { name: 'Pronunciation Lexicon', exact: true })).toBeVisible();

  await utils.captureScreenshot(page, 'lexicon_01_dialog_open');

  // Click Add Rule
  console.log('Adding new rule...');
  await page.getByTestId('lexicon-add-rule-btn').click();

  // Verify Match Type Select exists
  console.log('Verifying Match Type capability...');
  const matchTypeSelect = page.getByTestId('lexicon-match-type-select');
  await expect(matchTypeSelect).toBeVisible();

  // Toggle Match Type
  await matchTypeSelect.selectOption('regex');
  await expect(matchTypeSelect).toHaveValue('regex');
  await matchTypeSelect.selectOption('ignore_case');
  await expect(matchTypeSelect).toHaveValue('ignore_case');
  await matchTypeSelect.selectOption('regex'); // Leave regex selected for the rule

  // Check for Cancel Button (Bug Reproduction)
  console.log('Verifying Cancel button visibility...');
  const cancelBtn = page.getByTestId('lexicon-cancel-rule-btn');
  await expect(cancelBtn).toBeVisible();

  // Check containment
  console.log('Verifying button containment...');
  const container = page.locator('.border.rounded', { has: page.getByTestId('lexicon-input-original') }).first();
  const box = await container.boundingBox();
  const btnBox = await cancelBtn.boundingBox();

  if (box && btnBox) {
    expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(box.x + box.width + 5);
  } else {
    throw new Error('Container or button bounding box not found');
  }

  // Enter Rule Details
  console.log('Filling rule details...');
  await page.getByTestId('lexicon-input-original').fill('s/he');
  await page.getByTestId('lexicon-input-replacement').fill('they');

  // Save Rule
  // Dismiss keyboard by clicking outside inputs
  await page.getByRole('heading', { name: 'Pronunciation Lexicon' }).click();

  // Scroll the container to the bottom to ensure the new rule input (and buttons) are fully visible
  await page.getByTestId('lexicon-list-container').evaluate((el) => el.scrollTop = el.scrollHeight);

  // Use JS click to bypass viewport occlusion
  await page.getByTestId('lexicon-save-rule-btn').evaluate((el: HTMLElement) => el.click());

  // Verify Rule appears in list with Regex badge
  console.log('Verifying rule in list...');
  await expect(page.getByText('s/he')).toBeVisible();
  await expect(page.getByText('they')).toBeVisible();

  // Verify Regex badge
  await expect(page.getByTestId('lexicon-regex-badge')).toBeVisible();

  await utils.captureScreenshot(page, 'lexicon_02_rule_added');

  // --- Test Priority Toggle (Book Scope) ---
  console.log('Testing Priority Toggle (Book Scope)...');

  // Switch to Book Scope
  await page.getByRole('tab', { name: 'This Book' }).click();

  // Add Rule
  await page.getByTestId('lexicon-add-rule-btn').click();

  // Verify Priority Checkbox exists
  const priorityCheckbox = page.getByTestId('lexicon-priority-checkbox');
  await expect(priorityCheckbox).toBeVisible();

  // Fill Rule
  await page.getByTestId('lexicon-input-original').fill('PriorityWord');
  await page.getByTestId('lexicon-input-replacement').fill('Replaced');
  await priorityCheckbox.check();

  // Save Rule
  await page.getByTestId('lexicon-list-container').evaluate((el) => el.scrollTop = el.scrollHeight);
  await page.getByTestId('lexicon-save-rule-btn').click();

  // Verify Badge
  await expect(page.getByTestId('lexicon-priority-badge')).toBeVisible();
  await expect(page.getByText('Pre', { exact: true })).toBeVisible();

  await utils.captureScreenshot(page, 'lexicon_03_priority_rule_added');

  // Close Dialog
  console.log('Closing Lexicon...');
  await page.getByRole('button', { name: 'Close' }).last().click();

  await expect(page.getByRole('heading', { name: 'Pronunciation Lexicon', exact: true })).not.toBeVisible();

  console.log('Lexicon Journey Passed!');
});
