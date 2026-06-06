import { test, expect } from "./utils";
import { captureScreenshot, resetApp, ensureLibraryWithBook, navigateToChapter, waitForPersistedWrites } from "./utils";

test("tts resume after leaving book", async ({ page, baseURL }) => {
  console.log("Starting Resume After Navigation Test...");
  const finalBaseURL = baseURL || "http://localhost:5173";
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open Book
  console.log("Opening book...");
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId("reader-back-button")).toBeVisible();

  // Navigate to a chapter
  console.log("Navigating to chapter...");
  await navigateToChapter(page);

  // Open TTS Panel
  console.log("Opening TTS panel...");
  await page.getByTestId("reader-audio-button").click();
  await expect(page.getByTestId("tts-panel")).toBeVisible();

  // Wait for queue
  await expect(page.getByTestId("tts-queue-item-0")).toBeVisible({ timeout: 10000 });

  // Start playback and advance position
  console.log("Starting playback and advancing...");
  await page.getByTestId("tts-play-pause-button").click();
  await page.waitForTimeout(300);

  // Pause first to stop auto-advance while we skip
  await page.getByTestId("tts-play-pause-button").click();
  await page.waitForTimeout(500);

  // Skip forward with explicit wait for each item to become current
  await page.getByTestId("tts-forward-button").click();
  await expect(page.getByTestId("tts-queue-item-1")).toHaveAttribute("data-current", "true", { timeout: 10000 });

  await page.getByTestId("tts-forward-button").click();
  await expect(page.getByTestId("tts-queue-item-2")).toHaveAttribute("data-current", "true", { timeout: 10000 });

  await page.getByTestId("tts-forward-button").click();
  await expect(page.getByTestId("tts-queue-item-3")).toHaveAttribute("data-current", "true", { timeout: 10000 });
  console.log("At queue item 3");

  // Resume playback
  await page.getByTestId("tts-play-pause-button").click();
  console.log("At queue item 3");

  // Get the text of item 3 for later comparison
  const item3Text = await page.getByTestId("tts-queue-item-3").innerText();
  console.log(`Item 3 text: ${item3Text.substring(0, 50)}...`);

  // Pause playback
  await page.getByTestId("tts-play-pause-button").click();
  await page.waitForTimeout(500);

  // Close TTS panel
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Navigate back to library
  console.log("Going back to library...");
  await page.getByTestId("reader-back-button").click();
  await expect(page).toHaveURL(new RegExp(finalBaseURL.replace(/\/$/, "") + "/?$"), { timeout: 10000 });

  // Wait a moment for state to persist
  await page.waitForTimeout(1000);

  // Re-open the book
  console.log("Re-opening book...");
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId("reader-back-button")).toBeVisible();

  // Open TTS Panel
  console.log("Checking resumed TTS state...");
  await page.getByTestId("reader-audio-button").click();
  await expect(page.getByTestId("tts-panel")).toBeVisible({ timeout: 5000 });

  // Wait for queue to restore
  await page.waitForTimeout(2000);

  // Check that we resumed at or near item 3.
  //
  // Verify via the TTS store (useTTSStore), which is the source of truth for the resume
  // position. The queue DOM is just a view of it: on WebKit the audio Sheet's open
  // animation can momentarily leave the queue items `visibility:hidden`, which is a
  // rendering transient unrelated to resume correctness. Gating on DOM *visibility* here
  // made the test flaky; gating on the store (and on the items being *attached*) is
  // deterministic.
  const queueItems = page.locator("[data-testid^='tts-queue-item-']");
  await expect(queueItems.first()).toBeAttached({ timeout: 10000 });

  await page.waitForFunction(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = (window as any).useTTSStore?.getState?.();
      return !!s && Array.isArray(s.queue) && s.queue.length > 0 && typeof s.currentIndex === 'number';
    },
    undefined,
    { timeout: 10000 }
  );

  const resumeIndex = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).useTTSStore.getState().currentIndex as number
  );
  console.log(`Resumed at queue index: ${resumeIndex}`);

  // Should be at index 2 or greater (we advanced to item 3 before leaving).
  expect(resumeIndex).toBeGreaterThanOrEqual(2);
  await captureScreenshot(page, "resume_after_nav_success");
  console.log("Resume After Navigation Test Passed!");
});

test("tts position persists across reload", async ({ page }) => {
  console.log("Starting Position Persistence Across Reload Test...");
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open Book
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId("reader-back-button")).toBeVisible();

  // Navigate to chapter
  await navigateToChapter(page);

  // Open TTS Panel
  await page.getByTestId("reader-audio-button").click();
  await expect(page.getByTestId("tts-panel")).toBeVisible();

  // Wait for queue
  await expect(page.getByTestId("tts-queue-item-0")).toBeVisible({ timeout: 10000 });

  // Skip to item 5 without starting TTS (forward button works in stopped state too)
  console.log("Advancing to item 5...");
  // Skip with explicit item verification
  for (let i = 1; i <= 5; i++) {
    await page.getByTestId("tts-forward-button").click();
    await expect(page.getByTestId(`tts-queue-item-${i}`)).toHaveAttribute("data-current", "true", { timeout: 10000 });
  }

  // Verify at item 5
  await expect(page.getByTestId("tts-queue-item-5")).toHaveAttribute("data-current", "true", { timeout: 10000 });
  const item5Text = await page.getByTestId("tts-queue-item-5").innerText();
  console.log(`Item 5 text before reload: ${item5Text.substring(0, 50)}...`);

  // Let the debounced position writes (Yjs currentQueueIndex + DBService playback queue) reach
  // disk before the hard reload; otherwise the reload tears the page down with the writes still
  // buffered and the restored position is lost.
  await waitForPersistedWrites(page);

  // Reload page
  console.log("Reloading page...");
  await page.reload();
  await expect(page.getByTestId("reader-back-button")).toBeVisible({ timeout: 10000 });

  // Open TTS Panel
  await page.getByTestId("reader-audio-button").click();
  await expect(page.getByTestId("tts-panel")).toBeVisible({ timeout: 5000 });

  // Wait for queue restoration
  await page.waitForTimeout(2000);

  // Check that item 5 is still current after reload. Assert the restored position via the
  // TTS store (the source of truth) with a generous timeout — on WebKit under full-suite
  // load the session restore can lag, and the DOM data-current attribute follows the store.
  await page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).useTTSStore?.getState?.().currentIndex === 5,
    undefined,
    { timeout: 35000 }
  );
  const restoredText = await page.getByTestId("tts-queue-item-5").innerText();
  console.log(`Item 5 text after reload: ${restoredText.substring(0, 50)}...`);
  expect(item5Text).toBe(restoredText);
  console.log("Position Persistence Across Reload Test Passed!");

  await captureScreenshot(page, "position_persistence_success");
});
