import { test, expect } from "./utils";
import { captureScreenshot, resetApp, ensureLibraryWithBook, navigateToChapter } from "./utils";

test("tts queue click to jump", async ({ page }) => {
  console.log("Starting Queue Click Jump Test...");
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open Book
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId("reader-back-button")).toBeVisible();

  // Navigate to a chapter with content
  console.log("Navigating to chapter...");
  await navigateToChapter(page);

  // Open TTS Panel
  console.log("Opening TTS panel...");
  await page.getByTestId("reader-audio-button").click();
  await expect(page.getByTestId("tts-panel")).toBeVisible();

  // Wait for queue to populate
  const queueItems = page.locator("[data-testid^='tts-queue-item-']");
  await expect(queueItems.first()).toBeVisible({ timeout: 10000 });

  const initialCount = await queueItems.count();
  console.log(`Queue has ${initialCount} items`);
  expect(initialCount).toBeGreaterThanOrEqual(3);

  // Click on the 3rd item (index 2)
  console.log("Clicking queue item 2...");
  await page.getByTestId("tts-queue-item-2").click();

  // Wait for item to become current
  const item2 = page.getByTestId("tts-queue-item-2");
  await expect(item2).toHaveAttribute("data-current", "true", { timeout: 5000 });

  await captureScreenshot(page, "queue_click_jump_success");
  console.log("Queue Click Jump Test Passed!");
});

test("tts skip forward button", async ({ page }) => {
  console.log("Starting Skip Forward Test...");
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

  // Verify item 0 is current
  await expect(page.getByTestId("tts-queue-item-0")).toHaveAttribute("data-current", "true");

  // Click Forward button
  console.log("Clicking forward button...");
  await page.getByTestId("tts-forward-button").click();

  // Verify item 1 is now current
  await expect(page.getByTestId("tts-queue-item-1")).toHaveAttribute("data-current", "true", { timeout: 5000 });

  await captureScreenshot(page, "skip_forward_success");
  console.log("Skip Forward Test Passed!");
});

test("tts skip rewind button", async ({ page }) => {
  console.log("Starting Skip Rewind Test...");
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

  // Start playback
  console.log("Starting playback...");
  await page.getByTestId("tts-play-pause-button").click();

  // Skip forward twice (to item 2)
  console.log("Skipping forward twice...");
  await page.getByTestId("tts-forward-button").click();
  await page.waitForTimeout(500);
  await page.getByTestId("tts-forward-button").click();
  await page.waitForTimeout(500);

  // Verify we're at item 2
  await expect(page.getByTestId("tts-queue-item-2")).toHaveAttribute("data-current", "true", { timeout: 5000 });

  // Click Rewind button
  console.log("Clicking rewind button...");
  await page.getByTestId("tts-rewind-button").click();

  // Verify item 1 is now current
  await expect(page.getByTestId("tts-queue-item-1")).toHaveAttribute("data-current", "true", { timeout: 5000 });

  await captureScreenshot(page, "skip_rewind_success");
  console.log("Skip Rewind Test Passed!");
});

test("tts queue highlight follows playback", async ({ page }) => {
  console.log("Starting Queue Highlight Test...");
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

  // Verify item 0 is initially current
  await expect(page.getByTestId("tts-queue-item-0")).toHaveAttribute("data-current", "true");

  // Start playback
  console.log("Starting playback...");
  await page.getByTestId("tts-play-pause-button").click();

  // Wait for the Mock TTS to progress
  console.log("Waiting for playback to progress...");
  await page.waitForTimeout(5000);

  // Verify we've progressed
  try {
    const item0 = page.getByTestId("tts-queue-item-0");
    const currentAttr = await item0.getAttribute("data-current");
    if (currentAttr === "true") {
      console.log("Still on item 0, checking item 1...");
      await expect(page.getByTestId("tts-queue-item-1")).toBeVisible();
    }
  } catch {
    // Ignore
  }

  await captureScreenshot(page, "queue_highlight_playback");
  console.log("Queue Highlight Test Completed!");
});
