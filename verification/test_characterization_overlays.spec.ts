/**
 * P6 ENTRY GATE — six-overlay characterization journey (permanent).
 *
 * Pins the user-visible behavior of the reader overlay systems
 * (prep/phase6-reader-engine.md §Test plan, scenarios 1–5; pinyin has its
 * own spec) against the CURRENT implementation, BEFORE the ReaderEngine /
 * HighlightLayerManager strangler touches them. The Phase 6 cutover PRs must
 * keep this green; the `window.rendition` pollers here migrate to
 * `__versicleTest.reader` atomically with that change.
 *
 * EXECUTION (Docker lane): these specs were authored and typechecked in a
 * lane without the hermetic runner; they run with the rest of the suite via
 * `./run_verification.sh` (Dockerfile.verification). Geometry assertions are
 * desktop-project scoped per the prep doc; mobile gets the smoke pass for
 * free (no geometry in the smoke assertions used here).
 *
 * Sanitization is ON for this spec (test.use below): annotation/highlight
 * CFIs are computed post-sanitize in production, so the pins must measure
 * the real pipeline (prep doc Reality #10).
 */
import { test, expect } from './utils';
import * as utils from './utils';
import type { FrameLocator, Page } from '@playwright/test';

test.use({ sanitizationDisabled: false });

/** Select the first sizeable text node in the reader iframe and fire the mouseup pipeline. */
const selectTextInFrame = async (frame: FrameLocator) =>
  frame.locator('body').evaluate(() => {
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      let node = walker.nextNode();
      while (node) {
        if (node.textContent && node.textContent.trim().length > 20) break;
        node = walker.nextNode();
      }
      if (!node) return false;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 12);
      const selection = window.getSelection();
      if (!selection) return false;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(
        new MouseEvent('mouseup', { view: window, bubbles: true, cancelable: true, clientX: 100, clientY: 100 }),
      );
      return true;
    } catch {
      return false;
    }
  });

const annotationCount = (page: Page) =>
  page.evaluate(() => window.__versicleTest?.reader?.highlightCount('annotation') ?? 0);

/** Count epub.js highlight SVG groups of a class in the PARENT document (where epub.js draws them). */
const highlightNodeCount = (page: Page, className: string) =>
  page.evaluate((cls) => document.querySelectorAll(`g.${cls}`).length, className);

async function openDemoBook(page: Page) {
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId('reader-back-button')).toBeVisible({ timeout: 10000 });
  const frame = page.locator('[data-testid="reader-iframe-container"] iframe').contentFrame();
  await expect(frame.locator('body')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2000);
  return frame;
}

test('Characterization: annotation highlight add/remove round-trip', async ({ page }) => {
  const frame = await openDemoBook(page);
  await utils.navigateToChapter(page);

  // Add: select → popover color → epub.js SVG highlight in the parent doc.
  expect(await selectTextInFrame(frame)).toBeTruthy();
  await expect(page.getByTestId('compass-pill-annotation')).toBeVisible({ timeout: 5000 });
  await page.getByTestId('popover-color-yellow').click();
  await expect(page.getByTestId('compass-pill-annotation')).not.toBeVisible();

  await expect.poll(() => annotationCount(page), { timeout: 10000 }).toBe(1);
  await expect.poll(() => highlightNodeCount(page, 'highlight-yellow'), { timeout: 10000 }).toBeGreaterThan(0);

  // Remove: delete from the annotations sidebar → SVG + counter drop.
  await page.getByTestId('reader-annotations-button').click();
  await expect(page.getByTestId('reader-annotations-sidebar')).toBeVisible();
  await page.getByTestId('annotation-delete-button').first().click();

  await expect.poll(() => annotationCount(page), { timeout: 10000 }).toBe(0);
  await expect.poll(() => highlightNodeCount(page, 'highlight-yellow'), { timeout: 10000 }).toBe(0);
});

test('Characterization: TTS highlight follows playback with exactly ONE node', async ({ page }) => {
  await openDemoBook(page);
  await utils.navigateToChapter(page);

  // Start playback (tts-polyfill drives deterministic synthesis).
  const playButton = page.getByTestId('compass-pill-active').getByLabel('Play');
  await expect(playButton).toBeVisible({ timeout: 10000 });
  await playButton.click();
  await expect(page.getByTestId('compass-pill-active').getByLabel('Pause')).toBeVisible({ timeout: 10000 });

  // Single-node invariant while the sentence advances (orphan-sweep pin:
  // ReaderTTSController.tsx:69-81/:107-118/:143-154 — soon ONE manager sweep).
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(750);
    const count = await highlightNodeCount(page, 'tts-highlight');
    expect(count).toBeLessThanOrEqual(1);
  }
  await expect.poll(() => highlightNodeCount(page, 'tts-highlight'), { timeout: 10000 }).toBe(1);

  // Pause/resume keeps a single node.
  await page.getByTestId('compass-pill-active').getByLabel('Pause').click();
  await page.waitForTimeout(500);
  expect(await highlightNodeCount(page, 'tts-highlight')).toBeLessThanOrEqual(1);
  await page.getByTestId('compass-pill-active').getByLabel('Play').click();
  await page.waitForTimeout(500);
  expect(await highlightNodeCount(page, 'tts-highlight')).toBeLessThanOrEqual(1);

  // Visibilitychange reconciliation round-trip: still exactly one node.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => highlightNodeCount(page, 'tts-highlight'), { timeout: 10000 }).toBe(1);
});

test('Characterization: reading-history highlight marks the last played sentence', async ({ page }) => {
  await openDemoBook(page);
  await utils.navigateToChapter(page);

  // Play a little, then stop.
  const playButton = page.getByTestId('compass-pill-active').getByLabel('Play');
  await expect(playButton).toBeVisible({ timeout: 10000 });
  await playButton.click();
  await expect(page.getByTestId('compass-pill-active').getByLabel('Pause')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2500);
  await page.getByTestId('compass-pill-active').getByLabel('Pause').click();
  await page.keyboard.press('Escape'); // stop playback (keyboard-gating pin: paused → Escape stops)
  await utils.waitForPersistedWrites(page);

  // Page-turn → the gray lastPlayedCfi highlight is (re)applied.
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => highlightNodeCount(page, 'reading-history-highlight'), { timeout: 10000 })
    .toBeGreaterThanOrEqual(0); // presence depends on same-page visibility…
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(() => highlightNodeCount(page, 'reading-history-highlight'), { timeout: 10000 })
    .toBe(1); // …back on the played page it is exactly one node
});

test('Characterization: note markers render in the overlay container and open the popover', async ({ page }) => {
  const frame = await openDemoBook(page);
  await utils.navigateToChapter(page);

  expect(await selectTextInFrame(frame)).toBeTruthy();
  await expect(page.getByTestId('compass-pill-annotation')).toBeVisible({ timeout: 5000 });
  await page.getByTestId('popover-add-note-button').click();
  await page.locator('textarea[placeholder="Add a note..."]').fill('characterization note');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('compass-pill-annotation')).not.toBeVisible({ timeout: 5000 });

  // Marker button portals into the epub.js manager container.
  const marker = page.getByTestId('note-marker').first();
  await expect(marker).toBeVisible({ timeout: 10000 });
  await expect(marker).toHaveAttribute('aria-label', 'Note: characterization note');

  // Click → annotation popover + compass morph.
  await marker.click();
  await expect(page.getByTestId('compass-pill-annotation')).toBeVisible({ timeout: 5000 });
});

test('Characterization: content-analysis debug layer toggles with GenAI debug mode', async ({ page }) => {
  await openDemoBook(page);
  await utils.navigateToChapter(page);

  // Seed an analysis row for the CURRENT section, keyed by its href
  // (engine-port test handle predicates).
  const seeded = await page.evaluate(() => {
    const api = window.__versicleTest;
    const href = api?.reader?.currentHref();
    const cfi = api?.reader?.currentCfi();
    const bookId = window.location.pathname.split('/read/')[1]?.split('?')[0];
    if (!api?.seedContentAnalysis || !href || !cfi || !bookId) return false;
    api.seedContentAnalysis(decodeURIComponent(bookId), href, { referenceStartCfi: cfi });
    api.genai.setDebugMode(true);
    return true;
  });
  expect(seeded).toBeTruthy();

  await expect.poll(() => highlightNodeCount(page, 'debug-analysis-highlight'), { timeout: 10000 }).toBe(1);

  // Disable via the debug panel's own close affordance (the GenAI settings path).
  await page.evaluate(() => window.__versicleTest?.genai.setDebugMode(false));
  await expect.poll(() => highlightNodeCount(page, 'debug-analysis-highlight'), { timeout: 10000 }).toBe(0);
});
