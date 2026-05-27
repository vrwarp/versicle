import { test, expect } from './utils';
import * as utils from './utils';

test('Audio Bookmark Dismissal Test', async ({ page }) => {
  console.log('Starting Audio Bookmark Dismissal Test...');
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);

  // 1. Open Book
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId('reader-back-button')).toBeVisible();

  // 2. Programmatically trigger triage mode (to save time)
  console.log('Triggering audio-triage mode...');
  await page.evaluate(() => {
    (window as any).useReaderUIStore.getState().setCompassState({
      variant: 'audio-triage',
      targetAnnotation: {
        id: 'test-id',
        type: 'audio-bookmark',
        cfiRange: 'epubcfi(/6/4[chap1]!/4/2/2)',
        text: 'test text',
        bookId: 'test-book-id'
      }
    });
  });

  // Verify transition
  await expect(page.getByTestId('compass-pill-triage')).toBeVisible({ timeout: 5000 });
  console.log('Triage mode active.');

  // 3. Click elsewhere (on the reader header)
  console.log('Clicking elsewhere to dismiss...');
  await utils.captureScreenshot(page, 'dismiss_before_header_click');
  // Click on the header, but at a position that's likely empty in mobile (avoiding icons)
  await page.getByTestId('reader-header').click({ position: { x: 2, y: 2 } });
  await utils.captureScreenshot(page, 'dismiss_after_header_click');

  // 4. Expect dismissal
  console.log('Verifying dismissal...');
  await expect(page.getByTestId('compass-pill-triage')).not.toBeVisible({ timeout: 5000 });

  // 5. Try clicking inside the iframe (if possible)
  // We'll trigger triage mode again
  await page.evaluate(() => {
    (window as any).useReaderUIStore.getState().setCompassState({
      variant: 'audio-triage',
      targetAnnotation: {
        id: 'test-id',
        type: 'audio-bookmark',
        cfiRange: 'epubcfi(/6/4[chap1]!/4/2/2)',
        text: 'test text',
        bookId: 'test-book-id'
      }
    });
  });
  await expect(page.getByTestId('compass-pill-triage')).toBeVisible({ timeout: 5000 });

  // Click inside the iframe container click
  await page.getByTestId('reader-iframe-container').click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId('compass-pill-triage')).not.toBeVisible({ timeout: 5000 });

  // 6. Test X button dismissal
  console.log('Testing X button dismissal...');
  await page.evaluate(() => {
    (window as any).useReaderUIStore.getState().setCompassState({
      variant: 'audio-triage',
      targetAnnotation: {
        id: 'test-id',
        type: 'audio-bookmark',
        cfiRange: 'epubcfi(/6/4[chap1]!/4/2/2)',
        text: 'test text',
        bookId: 'test-book-id'
      }
    });
  });
  await expect(page.getByTestId('compass-pill-triage')).toBeVisible({ timeout: 5000 });
  await page.getByLabel('Dismiss review').click();
  await expect(page.getByTestId('compass-pill-triage')).not.toBeVisible({ timeout: 5000 });

  console.log('Audio Bookmark Dismissal Test Passed!');
});
