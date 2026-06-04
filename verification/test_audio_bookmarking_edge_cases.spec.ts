import { test, expect } from './utils';
import * as utils from './utils';

test('Timeout Protection', async ({ page }) => {
  // Verify that Pause -> Play sequences taking > 5 seconds do NOT trigger a bookmark.
  console.log('Testing Timeout Protection (Pause > 5s)...');
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  await page.locator("[data-testid^='book-card-']").first().click();
  await utils.navigateToChapter(page, 'toc-item-6');

  // Wait for TTS queue sync
  await page.waitForFunction(() => (window as any).useTTSStore.getState().queue.length > 0, { timeout: 15000 });

  // Start Playback
  await page.getByTestId('compass-pill-active').getByLabel('Play').click();
  await expect(page.getByTestId('compass-pill-active').getByLabel('Pause')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // Pause
  await page.getByTestId('compass-pill-active').getByLabel('Pause').click();
  await expect(page.getByTestId('compass-pill-active').getByLabel('Play')).toBeVisible({ timeout: 5000 });

  // Wait 6 seconds (timeout threshold is 5s)
  console.log('Waiting 6 seconds to exceed capture window...');
  await page.waitForTimeout(6000);

  // Play again — should NOT trigger Dragnet
  await page.getByTestId('compass-pill-active').getByLabel('Play').click();
  await page.waitForTimeout(2000);

  // Verify NO bookmark in store
  const bookmarkExists = await page.evaluate(() => {
    return Object.values((window as any).useAnnotationStore.getState().annotations).some((a: any) => a.type === 'audio-bookmark');
  });
  expect(bookmarkExists).toBeFalsy();
  await utils.captureScreenshot(page, 'edge_timeout_protection');
  console.log('Timeout protection verified.');
});

test('Navigation Guard', async ({ page }) => {
  // Previously WebKit-skipped. Now passes after clearing the Dragnet pause-timestamp on
  // the TOC navigation INTENT (see ReaderView onNavigate → AudioPlayerService.clearPauseGesture):
  // WebKit's slow rendition.display() relocation meant the section-change clear raced the
  // user's next play, capturing a stale audio-bookmark.
  // Verify that navigating to a new chapter during a pause prevents capturing stale context.
  console.log('Testing Navigation Guard...');
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  await page.locator("[data-testid^='book-card-']").first().click();
  await utils.navigateToChapter(page, 'toc-item-3');

  // Wait for queue to load for this chapter
  await page.waitForFunction(() => (window as any).useTTSStore.getState().queue.length > 0, { timeout: 15000 });

  // Start Playback
  await page.getByTestId('compass-pill-active').getByLabel('Play').click();
  await expect(page.getByTestId('compass-pill-active').getByLabel('Pause')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // Pause — this sets lastUserPauseTimestamp
  await page.getByTestId('compass-pill-active').getByLabel('Pause').click();
  await expect(page.getByTestId('compass-pill-active').getByLabel('Play')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000); // Allow WebKit to settle TTS state before TOC navigation

  // Navigate to a DIFFERENT chapter — this should clear lastUserPauseTimestamp
  console.log('Navigating to Chapter 5 during pause...');
  await utils.navigateToChapter(page, 'toc-item-6');

  // Wait for TTS queue to reload for the new chapter
  await page.waitForFunction(() => {
    const queue = (window as any).useTTSStore.getState().queue;
    return queue.length > 0;
  }, { timeout: 15000 });

  // Small stabilization wait for queue to fully settle
  await page.waitForTimeout(1000);

  // Play — should NOT trigger Dragnet because navigation cleared the timestamp
  await page.getByTestId('compass-pill-active').getByLabel('Play').click();
  await page.waitForTimeout(2000);

  // Verify NO bookmark in store
  console.log('Verifying no stale bookmark was created...');
  const bookmarkExists = await page.evaluate(() => {
    return Object.values((window as any).useAnnotationStore.getState().annotations).some((a: any) => a.type === 'audio-bookmark');
  });
  expect(bookmarkExists).toBeFalsy();
  await utils.captureScreenshot(page, 'edge_navigation_guard');
  console.log('Navigation guard verified.');
});

test('Inline HUD Discard', async ({ page }) => {
  // Verify that discarding a bookmark via the Triage HUD works correctly.
  console.log('Testing Inline HUD Discard...');
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  await page.locator("[data-testid^='book-card-']").first().click();
  await utils.navigateToChapter(page, 'toc-item-6');

  // Wait for TTS queue sync
  await page.waitForFunction(() => (window as any).useTTSStore.getState().queue.length > 0, { timeout: 15000 });

  // Trigger bookmark via gesture
  console.log('Triggering bookmark gesture...');
  await page.getByTestId('compass-pill-active').getByLabel('Play').click();
  await expect(page.getByTestId('compass-pill-active').getByLabel('Pause')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);

  await page.getByTestId('compass-pill-active').getByLabel('Pause').click();
  await expect(page.getByTestId('compass-pill-active').getByLabel('Play')).toBeVisible({ timeout: 5000 });

  await page.getByTestId('compass-pill-active').getByLabel('Play').click();

  // Wait for bookmark to appear in store
  console.log('Waiting for bookmark to appear in store...');
  await page.waitForFunction(() => {
    return Object.values((window as any).useAnnotationStore.getState().annotations).some((a: any) => a.type === 'audio-bookmark');
  }, { timeout: 10000 });

  // Programmatically trigger triage mode via the store
  console.log('Opening Triage HUD programmatically...');
  await page.evaluate(() => {
    const store = (window as any).useAnnotationStore.getState();
    const bookmark = Object.values(store.annotations).find((a: any) => a.type === 'audio-bookmark');
    if (bookmark) {
      (window as any).useReaderUIStore.getState().setCompassState({
        variant: 'audio-triage',
        targetAnnotation: bookmark
      });
    }
  });

  // Verify Triage HUD is visible
  console.log('Verifying Triage HUD state...');
  await expect(page.getByTestId('compass-pill-triage')).toBeVisible({ timeout: 5000 });
  const discardBtn = page.getByRole('button', { name: 'Discard' });
  await expect(discardBtn).toBeVisible();
  await utils.captureScreenshot(page, 'edge_hud_discard_before');

  // Click Discard
  console.log('Clicking Discard in HUD...');
  await discardBtn.click();

  // Verify HUD returns to normal and bookmark is gone from store
  await expect(page.getByTestId('compass-pill-triage')).not.toBeVisible();

  const bookmarkExists = await page.evaluate(() => {
    return Object.values((window as any).useAnnotationStore.getState().annotations).some((a: any) => a.type === 'audio-bookmark');
  });
  expect(bookmarkExists).toBeFalsy();
  await utils.captureScreenshot(page, 'edge_hud_discard_after');
  console.log('Inline HUD discard verified.');
});

test('Section Start Boundary', async ({ page }) => {
  // Verify that bookmarking at the very start of a section works (handles index 0).
  console.log('Testing Section Start Boundary...');
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  await page.locator("[data-testid^='book-card-']").first().click();
  await utils.navigateToChapter(page, 'toc-item-6');

  // Wait for TTS queue sync but do NOT play yet
  await page.waitForFunction(() => (window as any).useTTSStore.getState().queue.length > 0, { timeout: 15000 });

  // At index 0: Play briefly -> Pause -> Play
  console.log('Triggering gesture at index 0...');
  await page.getByTestId('compass-pill-active').getByLabel('Play').click();
  await page.waitForTimeout(200); // Very brief play
  await page.getByTestId('compass-pill-active').getByLabel('Pause').click();
  await page.getByTestId('compass-pill-active').getByLabel('Play').click();

  // Wait for bookmark to appear in store
  await page.waitForFunction(() => {
    return Object.values((window as any).useAnnotationStore.getState().annotations).some((a: any) => a.type === 'audio-bookmark');
  }, { timeout: 10000 });

  // Verify bookmark has text content
  const bookmark = await page.evaluate(() => {
    return Object.values((window as any).useAnnotationStore.getState().annotations).find((a: any) => a.type === 'audio-bookmark') as any;
  });
  expect(bookmark).toBeTruthy();
  expect(bookmark.text.length).toBeGreaterThan(0);
  await utils.captureScreenshot(page, 'edge_section_start');
  console.log('Section start boundary verified.');
});
