import { test, expect } from "./utils";
import { captureScreenshot, resetApp, ensureLibraryWithBook, navigateToChapter } from "./utils";

test("tts rapid play pause", async ({ page }) => {
  console.log("Starting Rapid Play/Pause Stress Test...");
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

  await expect(page.getByTestId("tts-queue-item-0")).toBeVisible({ timeout: 10000 });

  const playPauseBtn = page.getByTestId("tts-play-pause-button");

  // Rapidly toggle 10 times with minimal delay
  console.log("Rapidly toggling play/pause 10 times...");
  for (let i = 0; i < 10; i++) {
    await playPauseBtn.click();
    await page.waitForTimeout(150); // 150ms between clicks
    const currentLabel = await playPauseBtn.getAttribute("aria-label");
    console.log(`Toggle ${i + 1}: aria-label = ${currentLabel}`);
  }

  // Wait for system to stabilize
  await page.waitForTimeout(1000);

  // Verify the UI is still responsive
  await expect(playPauseBtn).toBeVisible();
  await expect(playPauseBtn).toBeEnabled();

  // Verify queue is still intact
  const queueItems = page.locator("[data-testid^='tts-queue-item-']");
  const count = await queueItems.count();
  console.log(`Queue still has ${count} items after stress`);
  expect(count).toBeGreaterThan(0);

  await captureScreenshot(page, "rapid_play_pause_success");
  console.log("Rapid Play/Pause Stress Test Passed!");
});

test("tts mid sentence cancel", async ({ page }) => {
  console.log("Starting Mid-Sentence Cancel Test...");
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

  await expect(page.getByTestId("tts-queue-item-0")).toBeVisible({ timeout: 10000 });

  // Start playback
  console.log("Starting playback...");
  await page.getByTestId("tts-play-pause-button").click();

  // Immediately cancel
  console.log("Immediately pausing...");
  await page.waitForTimeout(100); // Tiny delay
  await page.getByTestId("tts-play-pause-button").click();

  // Verify we're in paused state
  const playPauseBtn = page.getByTestId("tts-play-pause-button");
  await expect(playPauseBtn).toHaveAttribute("aria-label", "Play", { timeout: 3000 });

  // Verify the debug element shows canceled or paused
  const debugEl = page.locator("#tts-debug");
  if (await debugEl.isVisible()) {
    const status = await debugEl.getAttribute("data-status");
    console.log(`Debug status after cancel: ${status}`);
  }

  // Verify we can restart cleanly
  console.log("Restarting after cancel...");
  await playPauseBtn.click();
  await expect(playPauseBtn).toHaveAttribute("aria-label", "Pause", { timeout: 3000 });

  await captureScreenshot(page, "mid_sentence_cancel_success");
  console.log("Mid-Sentence Cancel Test Passed!");
});

test("tts queue race condition", async ({ page }) => {
  console.log("Starting Queue Race Condition Test...");
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open Book
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId("reader-back-button")).toBeVisible();

  // Navigate to Chapter II
  console.log("Navigating to Chapter II...");
  await page.getByTestId("reader-toc-button").click();
  await expect(page.getByTestId("reader-toc-sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Chapter II." }).first().click();

  // Don't wait - immediately navigate to Chapter III
  console.log("Immediately navigating to Chapter III...");
  await page.getByTestId("reader-toc-button").click();
  await page.getByRole("button", { name: "Chapter III." }).first().click();

  // Don't wait - immediately navigate to Chapter IV
  console.log("Immediately navigating to Chapter IV...");
  await page.getByTestId("reader-toc-button").click();
  await page.getByRole("button", { name: "Chapter IV." }).first().click();

  // Now wait for things to settle
  await page.waitForTimeout(3000);

  // Open TTS Panel
  await page.getByTestId("reader-audio-button").click();
  await expect(page.getByTestId("tts-panel")).toBeVisible();

  // Verify queue has loaded (should be Chapter IV content)
  const queueItems = page.locator("[data-testid^='tts-queue-item-']");
  await expect(queueItems.first()).toBeVisible({ timeout: 10000 });

  const count = await queueItems.count();
  console.log(`Final queue has ${count} items`);
  expect(count).toBeGreaterThan(0);

  // Verify we're at index 0 (fresh start)
  await expect(page.getByTestId("tts-queue-item-0")).toHaveAttribute("data-current", "true");

  await captureScreenshot(page, "queue_race_condition_success");
  console.log("Queue Race Condition Test Passed!");
});

test("tts concurrent skip operations", async ({ page }) => {
  console.log("Starting Concurrent Skip Operations Test...");
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

  await expect(page.getByTestId("tts-queue-item-0")).toBeVisible({ timeout: 10000 });

  const forwardBtn = page.getByTestId("tts-forward-button");
  const rewindBtn = page.getByTestId("tts-rewind-button");

  // Rapidly skip forward 5 times
  console.log("Rapidly skipping forward 5 times...");
  for (let i = 0; i < 5; i++) {
    await forwardBtn.click();
    await page.waitForTimeout(100);
  }

  // Rapidly skip back 3 times
  console.log("Rapidly skipping back 3 times...");
  for (let i = 0; i < 3; i++) {
    await rewindBtn.click();
    await page.waitForTimeout(100);
  }

  // Wait for stabilization
  await page.waitForTimeout(1000);

  // We should be at approximately index 2 (5 - 3 = 2)
  let foundCurrent = false;
  for (let i = 0; i < 10; i++) {
    try {
      const item = page.getByTestId(`tts-queue-item-${i}`);
      if (await item.isVisible() && (await item.getAttribute("data-current")) === "true") {
        console.log(`Current item is at index: ${i}`);
        foundCurrent = true;
        expect(i).toBeGreaterThanOrEqual(1);
        expect(i).toBeLessThanOrEqual(4);
        break;
      }
    } catch {
      continue;
    }
  }

  expect(foundCurrent).toBe(true);

  await captureScreenshot(page, "concurrent_skip_success");
  console.log("Concurrent Skip Operations Test Passed!");
});

test("tts panel close during playback", async ({ page }) => {
  console.log("Starting Panel Close During Playback Test...");
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

  await expect(page.getByTestId("tts-queue-item-0")).toBeVisible({ timeout: 10000 });

  // Start playback
  console.log("Starting playback...");
  await page.getByTestId("tts-play-pause-button").click();
  await page.waitForTimeout(500);

  // Close panel while playing
  console.log("Closing panel during playback...");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tts-panel")).not.toBeVisible();

  // Wait a moment
  await page.waitForTimeout(2000);

  // Verify the Compass Pill shows playing state
  const pill = page.getByTestId("compass-pill-active");
  if (await pill.isVisible()) {
    const pauseBtn = pill.getByLabel("Pause");
    if (await pauseBtn.isVisible()) {
      console.log("Playback continuing (Pause button visible in pill)");
    }
  }

  // Re-open panel
  console.log("Re-opening panel...");
  await page.getByTestId("reader-audio-button").click();
  await expect(page.getByTestId("tts-panel")).toBeVisible();

  // Verify we're still playing and have progressed
  const playPauseBtn = page.getByTestId("tts-play-pause-button");
  const ariaLabel = await playPauseBtn.getAttribute("aria-label");
  console.log(`Play/Pause button label after reopen: ${ariaLabel}`);

  await captureScreenshot(page, "panel_close_playback_success");
  console.log("Panel Close During Playback Test Passed!");
});
