import { test, expect } from './utils';
import * as utils from './utils';

test('Journey Audio Test', async ({ page }) => {
  console.log('Starting Audio Journey...');
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  // Open Book
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId('reader-back-button')).toBeVisible();

  // Navigate to Chapter 5 via TOC to ensure we have content for audio
  console.log('Navigating to Chapter 5...');
  await utils.navigateToChapter(page);

  // --- Part 1: Audio HUD Interaction ---
  console.log('--- Testing Audio HUD ---');
  await expect(page.getByTestId('compass-pill-active')).toBeVisible({ timeout: 10000 });
  await utils.captureScreenshot(page, 'audio_1_hud_visible');

  // Check for Play Button inside the Compass Pill
  const playButton = page.getByTestId('compass-pill-active').getByLabel('Play');
  await expect(playButton).toBeVisible();

  // Click Play
  console.log('Clicking Play...');
  await playButton.click();
  await expect(page.getByTestId('compass-pill-active').getByLabel('Pause')).toBeVisible({ timeout: 5000 });

  // Click Pause
  console.log('Clicking Pause...');
  await page.getByTestId('compass-pill-active').getByLabel('Pause').click();
  await expect(playButton).toBeVisible();

  // --- Part 2: Audio Deck ---
  console.log('--- Testing Audio Deck ---');
  // Open Audio Deck
  await page.getByTestId('reader-audio-button').click();

  // Verify Sheet Content
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Audio Deck')).toBeVisible();

  // Verify Stage Buttons
  await expect(page.getByRole('dialog').getByLabel('Play')).toBeVisible();
  await expect(page.getByTestId('tts-rewind-button')).toBeVisible();
  await expect(page.getByTestId('tts-forward-button')).toBeVisible();

  // Switch to Settings
  console.log('Switching to Audio Settings...');
  await utils.switchAudioPanelView(page, 'settings');
  await expect(page.getByText('Voice & Pace')).toBeVisible();
  await expect(page.getByText('Flow Control')).toBeVisible();

  await utils.captureScreenshot(page, 'audio_2_deck_settings');

  // Switch back to Queue
  console.log('Switching back to Queue...');
  await utils.switchAudioPanelView(page, 'queue');

  // --- Enhanced Queue Assertions ---
  console.log('Verifying queue content...');
  const queueItems = page.locator("[data-testid^='tts-queue-item-']");
  await expect(queueItems.first()).toBeVisible({ timeout: 5000 });

  const queueCount = await queueItems.count();
  console.log(`Queue contains ${queueCount} items`);
  expect(queueCount).toBeGreaterThanOrEqual(3);

  // Verify first item has text content (not empty)
  const firstItemText = await page.getByTestId('tts-queue-item-0').innerText();
  console.log(`First queue item: ${firstItemText.slice(0, 80)}...`);
  expect(firstItemText.trim().length).toBeGreaterThan(10);

  await utils.captureScreenshot(page, 'audio_2b_queue_verified');

  // Close Audio Deck
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tts-panel')).not.toBeVisible();

  // --- Part 3: Summary Mode in Library ---
  console.log('--- Testing Summary Mode in Library ---');
  await page.getByTestId('reader-back-button').click();

  // Wait for Library
  await expect(page).toHaveURL('http://localhost:5173/');

  // Check for Summary Pill
  await expect(page.getByTestId('compass-pill-summary')).toBeVisible();

  // Ensure active pill is gone
  await expect(page.getByTestId('compass-pill-active')).not.toBeVisible();

  await utils.captureScreenshot(page, 'audio_3_summary_mode');

  console.log('Audio Journey Passed!');
});
