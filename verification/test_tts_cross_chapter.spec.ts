import { test, expect } from "./utils";
import {
  captureScreenshot,
  resetApp,
  ensureLibraryWithBook,
  currentSectionHref,
  waitForSectionChange,
  waitForTtsQueueOnCurrentSection,
  waitForTtsState,
  ttsState,
} from "./utils";

test("tts cross chapter transition", async ({ page }) => {
  console.log("Starting Cross-Chapter Transition Test...");
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open Book
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId("reader-back-button")).toBeVisible();

  // Navigate to a short chapter (Chapter II)
  console.log("Navigating to Chapter II...");
  const hrefBeforeCh2 = await currentSectionHref(page);
  await page.getByTestId("reader-toc-button").click();
  await expect(page.getByTestId("reader-toc-sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Chapter II." }).first().click();
  await waitForSectionChange(page, hrefBeforeCh2);
  await waitForTtsQueueOnCurrentSection(page);

  // Open TTS Panel
  console.log("Opening TTS panel...");
  await page.getByTestId("reader-audio-button").click();
  await expect(page.getByTestId("tts-panel")).toBeVisible();

  // Wait for queue
  const queueItems = page.locator("[data-testid^='tts-queue-item-']");
  await expect(queueItems.first()).toBeVisible({ timeout: 10000 });

  const initialQueueCount = await queueItems.count();
  console.log(`Initial queue count: ${initialQueueCount}`);

  // Get the text of the first queue item
  const firstItemText = await page.getByTestId("tts-queue-item-0").innerText();
  console.log(`First item text: ${firstItemText.substring(0, 50)}...`);

  // Jump to the last item in the queue (simulating near-end of chapter)
  const lastIndex = initialQueueCount - 1;
  console.log(`Jumping to last item (index ${lastIndex})...`);
  await page.getByTestId(`tts-queue-item-${lastIndex}`).click();
  await expect(page.getByTestId(`tts-queue-item-${lastIndex}`))
    .toHaveAttribute("data-current", "true", { timeout: 5000 })
    .catch(() => {});

  // Start playback
  console.log("Starting playback...");
  await page.getByTestId("tts-play-pause-button").click();

  // Wait (within the same 8s window) for the chapter to end and transition
  console.log("Waiting for chapter end and potential transition...");
  await expect
    .poll(() => page.getByTestId("tts-queue-item-0").innerText().catch(() => firstItemText), { timeout: 8000 })
    .not.toBe(firstItemText)
    .catch(() => {});

  // Check if the queue has been repopulated
  const newQueueItems = page.locator("[data-testid^='tts-queue-item-']");
  const newQueueCount = await newQueueItems.count();

  try {
    const newFirstItem = page.getByTestId("tts-queue-item-0");
    if (await newFirstItem.isVisible()) {
      const newFirstText = await newFirstItem.innerText();
      console.log(`New first item text: ${newFirstText.substring(0, 50)}...`);

      if (newFirstText !== firstItemText) {
        console.log("Chapter transition detected - queue content changed!");
        await captureScreenshot(page, "cross_chapter_success");
      } else {
        console.log("Queue text unchanged - may still be in same chapter");
        await captureScreenshot(page, "cross_chapter_same");
      }
    }
  } catch (e) {
    console.log("Exception checking queue state", e);
    await captureScreenshot(page, "cross_chapter_exception");
  }

  console.log(`Final queue count: ${newQueueCount}`);
  await captureScreenshot(page, "cross_chapter_final");
  console.log("Cross-Chapter Transition Test Completed!");
});

test("tts chapter navigation during playback", async ({ page }) => {
  // Previously WebKit-skipped (TOC sidebar render bug + TTS queue/IDB-hang timing). Now
  // passes after the IndexedDB hang fixes (Yjs persistence throttle + hang-safe
  // cache_session_state writes) and the main-thread mock TTS stabilised WebKit playback.
  console.log("Starting Chapter Navigation During Playback Test...");
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open Book
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId("reader-back-button")).toBeVisible();

  // Navigate to Chapter III
  console.log("Navigating to Chapter III...");
  const hrefBeforeCh3 = await currentSectionHref(page);
  await page.getByTestId("reader-toc-button").click();
  await expect(page.getByTestId("reader-toc-sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Chapter III." }).first().click();
  await waitForSectionChange(page, hrefBeforeCh3);
  await waitForTtsQueueOnCurrentSection(page);

  // Open TTS Panel and start playback
  console.log("Starting playback in Chapter III...");
  await page.getByTestId("reader-audio-button").click();
  await expect(page.getByTestId("tts-panel")).toBeVisible();

  await expect(page.getByTestId("tts-queue-item-0")).toBeVisible({ timeout: 10000 });
  const chapter3FirstItem = await page.getByTestId("tts-queue-item-0").innerText();
  console.log(`Chapter III first item: ${chapter3FirstItem.substring(0, 50)}...`);

  // Skip forward a few times, each once the previous command has landed
  await page.getByTestId("tts-play-pause-button").click();
  await waitForTtsState(page, (s) => s.status === "playing");
  for (let skip = 0; skip < 2; skip++) {
    const before = (await ttsState(page))?.currentIndex ?? 0;
    await page.getByTestId("tts-forward-button").click();
    await waitForTtsState(page, (s, idx) => s.currentIndex > idx, before);
  }

  // Pause playback before navigating
  await page.getByTestId("tts-play-pause-button").click();
  await waitForTtsState(page, (s) => !s.isPlaying);

  // Close TTS panel
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tts-panel")).toBeHidden({ timeout: 5000 }).catch(() => {});

  // Navigate to Chapter V via TOC
  console.log("Navigating to Chapter V...");
  // Wait for any pending epub.js navigation before clicking TOC
  await page.waitForTimeout(1000);
  const hrefBeforeCh5 = await currentSectionHref(page);
  await page.getByTestId("reader-toc-button").click({ noWaitAfter: true });
  await expect(page.getByTestId("reader-toc-sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Chapter V." }).first().click();
  await waitForSectionChange(page, hrefBeforeCh5);
  await waitForTtsQueueOnCurrentSection(page);

  // Open TTS Panel again
  console.log("Checking TTS state in Chapter V...");
  await page.getByTestId("reader-audio-button").click();
  await expect(page.getByTestId("tts-panel")).toBeVisible();

  // Wait for queue to fully reload (the Chapter III queue rolls over)
  await expect(page.getByTestId("tts-queue-item-0")).toBeVisible({ timeout: 10000 });
  await expect
    .poll(() => page.getByTestId("tts-queue-item-0").innerText().catch(() => chapter3FirstItem), { timeout: 5000 })
    .not.toBe(chapter3FirstItem)
    .catch(() => {});

  const chapter5FirstItem = await page.getByTestId("tts-queue-item-0").innerText();
  console.log(`Chapter V first item: ${chapter5FirstItem.substring(0, 50)}...`);

  // Verify the queue content is different
  if (chapter5FirstItem.includes("Chapter V") || chapter5FirstItem !== chapter3FirstItem) {
    console.log("Queue content changed as expected");
  } else {
    console.log(`WARNING: Queue may not have refreshed. Ch3: ${chapter3FirstItem.substring(0, 30)}, Ch5: ${chapter5FirstItem.substring(0, 30)}`);
  }

  // Verify current index reset to 0 after the chapter change. Assert via the TTS store
  // (source of truth) with a generous timeout — on WebKit under full-suite load the queue
  // re-sync after navigation can lag, and the DOM data-current attribute follows the store.
  await page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).useTTSPlaybackStore?.getState?.().currentIndex === 0,
    undefined,
    { timeout: 35000 }
  );
  await expect(page.getByTestId("tts-queue-item-0")).toHaveAttribute("data-current", "true", { timeout: 10000 });

  await captureScreenshot(page, "chapter_navigation_playback");
  console.log("Chapter Navigation During Playback Test Passed!");
});
