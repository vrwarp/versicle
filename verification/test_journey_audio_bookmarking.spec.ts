import { test, expect } from './utils';
import * as utils from './utils';

test('Journey Audio Bookmarking Test', async ({ page }) => {
  console.log('Starting Audio Bookmarking Journey...');
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  // 1. Open Book
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId('reader-back-button')).toBeVisible();

  // Navigate to ensure we are not at absolute start
  console.log('Navigating to Chapter 5 (toc-item-6)...');
  await utils.navigateToChapter(page, 'toc-item-6');

  // Wait for active HUD
  await expect(page.getByTestId('compass-pill-active')).toBeVisible({ timeout: 10000 });

  // SECURE SYNC: Wait for the TTS engine to actually load the new chapter's text
  console.log('Waiting for TTS queue synchronization...');
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queue = (window as any).useTTSStore.getState().queue;
    return queue.length > 0;
  }, { timeout: 15000 });

  // --- PART 1: Simulate Gesture ---
  console.log('Simulating Pause/Play gesture...');

  // Start Playback
  await page.getByTestId('compass-pill-active').getByLabel('Play').click();
  await expect(page.getByTestId('compass-pill-active').getByLabel('Pause')).toBeVisible({ timeout: 5000 });

  // Wait for a sentence to be spoken to advance index
  await page.waitForTimeout(1000);

  // Pause
  await page.getByTestId('compass-pill-active').getByLabel('Pause').click();
  await expect(page.getByTestId('compass-pill-active').getByLabel('Play')).toBeVisible({ timeout: 5000 });

  // Play again within 2 seconds (triggers Dragnet capture)
  await page.getByTestId('compass-pill-active').getByLabel('Play').click();

  // Wait for the async capture to complete in store
  console.log('Waiting for bookmark to appear in store...');
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Object.values((window as any).useAnnotationStore.getState().annotations).some((a: any) => a.type === 'audio-bookmark');
  }, { timeout: 10000 });

  await utils.captureScreenshot(page, 'bookmark_1_captured');

  // --- PART 2: Inline Triage ---
  console.log('Testing Inline Triage...');

  // Programmatically trigger triage mode via the store.
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).useAnnotationStore.getState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bookmark = Object.values(store.annotations).find((a: any) => a.type === 'audio-bookmark');
    if (bookmark) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).useReaderUIStore.getState().setCompassState({
        variant: 'audio-triage',
        targetAnnotation: bookmark
      });
    }
  });

  // Verify CompassPill variant
  await expect(page.getByTestId('compass-pill-triage')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Review Bookmark')).toBeVisible();
  await utils.captureScreenshot(page, 'bookmark_2_triage_mode');

  // Confirm elevation
  console.log('Confirming triage...');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('compass-pill-triage')).not.toBeVisible();

  // Verify elevation in store
  const isHighlight = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).useAnnotationStore.getState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Object.values(store.annotations).some((a: any) => a.type === 'highlight');
  });
  expect(isHighlight).toBeTruthy();

  // --- PART 3: Global Inbox ---
  console.log('Testing Global Inbox...');

  // First ensure TTS is playing so we can pause/play to create a second bookmark
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isPlaying = await page.evaluate(() => (window as any).useTTSStore.getState().isPlaying);
  if (!isPlaying) {
    await page.getByTestId('compass-pill-active').getByLabel('Play').click();
    await expect(page.getByTestId('compass-pill-active').getByLabel('Pause')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);
  }

  // Create another bookmark to test the global inbox
  // Pause
  await page.getByTestId('compass-pill-active').getByLabel('Pause').click();
  await expect(page.getByTestId('compass-pill-active').getByLabel('Play')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(300);
  // Play (triggers Dragnet)
  await page.getByTestId('compass-pill-active').getByLabel('Play').click();

  // Wait for the second bookmark to appear
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Object.values((window as any).useAnnotationStore.getState().annotations)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((a: any) => a.type === 'audio-bookmark').length > 0;
  }, { timeout: 10000 });

  // Go back to library
  await page.getByTestId('reader-back-button').click();

  // Switch to Notes view
  await page.locator('button[aria-label="Select view context"]').click();
  await page.locator('div[role="option"]', { hasText: 'Notes' }).click();

  await expect(page.getByTestId('global-notes-view')).toBeVisible();

  // Verify Inbox presence
  await expect(page.getByText('Audio Bookmarks Inbox')).toBeVisible({ timeout: 5000 });
  await utils.captureScreenshot(page, 'bookmark_3_global_inbox');

  // Verify discard action
  console.log('Testing Discard in Global Inbox...');
  await page.getByRole('button', { name: 'Discard' }).first().click();

  // After discarding all bookmarks, the inbox should disappear
  const remaining = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Object.values((window as any).useAnnotationStore.getState().annotations)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((a: any) => a.type === 'audio-bookmark').length;
  });
  if (remaining === 0) {
    await expect(page.getByText('Audio Bookmarks Inbox')).not.toBeVisible();
  }

  console.log('Audio Bookmarking Journey Passed!');
});
