/**
 * Verifies that the CompassPill scrubber (background progress bar) stays in sync
 * with TTS chapter position, not the global book reading percentage.
 *
 * Regression: commit 6d9c4c35 removed the `!hasQueueItems` guard when passing
 * `progress` to CompassPill from ReaderControlBar, causing the scrubber to always
 * show the frozen global book percentage instead of the live TTS chapter position.
 */
import { test, expect } from "./utils";
import { resetApp, ensureLibraryWithBook, navigateToChapter, captureScreenshot } from "./utils";

/** Read the current scrubber width as a float (0–100). */
async function getScrubberWidth(page: Parameters<typeof resetApp>[0]): Promise<number> {
  return page.locator('[data-testid="compass-pill-progress-bar"]').evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el: any) => parseFloat(el.style.width) || 0
  );
}

/** Read {currentIndex, queueLength} from the live TTS store. */
async function getTTSProgress(page: Parameters<typeof resetApp>[0]): Promise<{ index: number; total: number }> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (window as any).useTTSPlaybackStore?.getState?.();
    return { index: s?.currentIndex ?? 0, total: s?.queue?.length ?? 0 };
  });
}

test("scrubber tracks TTS chapter position during playback", async ({ page }) => {
  console.log("Starting CompassPill scrubber sync test...");
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open book and navigate to a content-rich chapter
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId("reader-back-button")).toBeVisible();
  await navigateToChapter(page);

  // Compass pill should be visible (active mode)
  await expect(page.getByTestId("compass-pill-active")).toBeVisible({ timeout: 10000 });

  // Open TTS deck and wait for queue to populate
  console.log("Opening TTS panel and waiting for queue...");
  await page.getByTestId("reader-audio-button").click();
  await expect(page.getByTestId("tts-panel")).toBeVisible();
  await expect(page.getByTestId("tts-queue-item-0")).toBeVisible({ timeout: 10000 });

  // Capture queue length and initial index
  const { total: queueLength } = await getTTSProgress(page);
  console.log(`Queue length: ${queueLength}`);
  expect(queueLength).toBeGreaterThanOrEqual(4); // Need at least 4 items to advance meaningfully

  // Capture the global book reading percentage (this should NOT drive the scrubber during TTS)
  const globalBookPct = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).useReadingStateStore?.getState?.();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bookId = (window as any).useReaderUIStore?.getState?.().currentBookId;
    return bookId ? (store?.getProgress?.(bookId)?.percentage ?? 0) * 100 : 0;
  });
  console.log(`Global book reading pct: ${globalBookPct.toFixed(1)}%`);

  // Close TTS panel to access the compass pill scrubber
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tts-panel")).not.toBeVisible();

  // Record scrubber width at index 0 (should be ~0%)
  const widthAtStart = await getScrubberWidth(page);
  console.log(`Scrubber at queue index 0: ${widthAtStart.toFixed(1)}%`);

  // Open TTS panel again to navigate via skip buttons
  await page.getByTestId("reader-audio-button").click();
  await expect(page.getByTestId("tts-panel")).toBeVisible();
  await expect(page.getByTestId("tts-queue-item-0")).toBeVisible({ timeout: 5000 });

  // Start and immediately pause to safely skip forward
  await page.getByTestId("tts-play-pause-button").click();
  await page.waitForTimeout(300);
  await page.getByTestId("tts-play-pause-button").click();
  await page.waitForTimeout(300);

  // Skip forward to index 3 (deterministically, one step at a time)
  console.log("Advancing TTS to index 3...");
  for (let i = 0; i < 3; i++) {
    await page.getByTestId("tts-forward-button").click();
    await expect(page.getByTestId(`tts-queue-item-${i + 1}`)).toHaveAttribute(
      "data-current", "true", { timeout: 5000 }
    );
  }

  const { index: indexAfterSkip } = await getTTSProgress(page);
  console.log(`TTS currentIndex after skip: ${indexAfterSkip}`);
  expect(indexAfterSkip).toBe(3);

  // Close TTS panel to check the scrubber in the compass pill
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tts-panel")).not.toBeVisible();

  const widthAfterSkip = await getScrubberWidth(page);
  const expectedPct = (indexAfterSkip / queueLength) * 100;
  console.log(`Scrubber after skip to index ${indexAfterSkip}: ${widthAfterSkip.toFixed(1)}% (expected ~${expectedPct.toFixed(1)}%)`);

  await captureScreenshot(page, "scrubber_at_index_3");

  // Core assertion: scrubber reflects TTS chapter position
  // Must be non-zero (not stuck), and must closely track the TTS position.
  // Note: for long chapters, index 3 of many items can be well below 5%, so we
  // only require > 0 here; toBeCloseTo is the real correctness check.
  expect(widthAfterSkip).toBeGreaterThan(0);
  expect(widthAfterSkip).toBeCloseTo(expectedPct, 0 /* 0 decimal places = ±0.5% */);

  // Regression guard: scrubber must NOT be pinned to the global book reading percentage.
  // If the bug were present, widthAfterSkip ≈ globalBookPct (a small, nearly-constant value)
  // while expectedPct would be much larger (index 3 / ~10+ items = 25–75%).
  if (globalBookPct < expectedPct - 10) {
    console.log(`Regression check: scrubber (${widthAfterSkip.toFixed(1)}%) >> global book % (${globalBookPct.toFixed(1)}%) — correct`);
    expect(widthAfterSkip).toBeGreaterThan(globalBookPct + 5);
  }

  console.log("Scrubber sync test passed!");
});

test("scrubber shows book reading progress when TTS queue is empty", async ({ page }) => {
  console.log("Starting scrubber-without-TTS test...");
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open book and navigate to a chapter with content
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId("reader-back-button")).toBeVisible();

  // Navigate to chapter 2 (toc-item-2) so there is some non-zero book reading progress
  await navigateToChapter(page, "toc-item-2");
  await expect(page.getByTestId("compass-pill-active")).toBeVisible({ timeout: 10000 });

  // Dwell long enough for the reading session to record > 0% progress.
  // We do NOT press ArrowRight here: some epub.js paginated builds emit a
  // `relocated` event with percentage=0 on the first render of the new page,
  // which overwrites the valid chapter percentage before the real value is
  // committed — leaving the current-device progress stuck at 0%.
  await page.waitForTimeout(3000);

  // Ensure TTS queue is empty (no TTS initiated)
  const { total: queueLength } = await getTTSProgress(page);
  console.log(`TTS queue length (should be 0): ${queueLength}`);

  // When queue is empty, scrubber uses the global reading percentage from the store.
  // Wait for both the store to have non-zero progress AND the DOM to reflect it
  // (React re-render may lag a tick behind the Zustand state update).
  await page.waitForFunction(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).useReadingStateStore?.getState?.();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bookId = (window as any).useReaderUIStore?.getState?.().currentBookId;
      const pct = bookId ? (store?.getProgress?.(bookId)?.percentage ?? 0) * 100 : 0;
      const el = document.querySelector('[data-testid="compass-pill-progress-bar"]');
      return pct > 0 && el !== null && parseFloat((el as HTMLElement).style.width) > 0;
    },
    undefined,
    { timeout: 12000 }
  ).catch(() => { /* fall through to assertion so the failure message is readable */ });
  const scrubberWidth = await getScrubberWidth(page);
  const globalBookPct = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).useReadingStateStore?.getState?.();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bookId = (window as any).useReaderUIStore?.getState?.().currentBookId;
    return bookId ? (store?.getProgress?.(bookId)?.percentage ?? 0) * 100 : 0;
  });

  console.log(`Scrubber: ${scrubberWidth.toFixed(1)}%, global book %: ${globalBookPct.toFixed(1)}%`);

  await captureScreenshot(page, "scrubber_no_tts");

  // Scrubber should match the global book reading percentage when no TTS is active
  expect(scrubberWidth).toBeCloseTo(globalBookPct, 0);

  console.log("Scrubber-without-TTS test passed!");
});

test("scrubber advances as TTS plays through sentences", async ({ page }) => {
  console.log("Starting scrubber live-advance test...");
  await resetApp(page);
  await ensureLibraryWithBook(page);

  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId("reader-back-button")).toBeVisible();
  await navigateToChapter(page);
  await expect(page.getByTestId("compass-pill-active")).toBeVisible({ timeout: 10000 });

  // Open TTS and wait for queue
  await page.getByTestId("reader-audio-button").click();
  await expect(page.getByTestId("tts-panel")).toBeVisible();
  await expect(page.getByTestId("tts-queue-item-0")).toBeVisible({ timeout: 10000 });

  const { total: queueLength } = await getTTSProgress(page);
  expect(queueLength).toBeGreaterThanOrEqual(4);

  // Close panel and record width before playback
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tts-panel")).not.toBeVisible();

  const widthBefore = await getScrubberWidth(page);
  console.log(`Scrubber before play: ${widthBefore.toFixed(1)}%`);

  // Start playback and let mock TTS advance naturally
  console.log("Starting TTS playback...");
  await page.getByTestId("compass-active-toggle").click();

  // Wait for TTS to advance at least 2 positions (mock TTS is fast).
  // Pass undefined as arg so Playwright treats the third argument as options,
  // not as the page-function argument (which would override the 10s page default).
  await page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).useTTSPlaybackStore?.getState?.().currentIndex >= 2,
    undefined,
    { timeout: 20000 }
  );

  const { index: liveIndex } = await getTTSProgress(page);
  const expectedWidth = (liveIndex / queueLength) * 100;

  // Allow the CSS transition to settle
  await page.waitForTimeout(400);

  const widthAfterPlay = await getScrubberWidth(page);
  console.log(`Scrubber during play at index ${liveIndex}/${queueLength}: ${widthAfterPlay.toFixed(1)}% (expected ~${expectedWidth.toFixed(1)}%)`);

  await captureScreenshot(page, "scrubber_live_advance");

  // Scrubber must have advanced from its starting position (widthBefore is ~0 at index 0).
  // Use expectedWidth - 1 so the bound scales with queue length rather than a fixed 5%.
  expect(widthAfterPlay).toBeGreaterThan(Math.max(0, expectedWidth - 1));
  // And must track the TTS position, not a stale value
  expect(widthAfterPlay).toBeCloseTo(expectedWidth, 0);

  // Pause to clean up
  await page.getByTestId("compass-active-toggle").click();

  console.log("Scrubber live-advance test passed!");
});
