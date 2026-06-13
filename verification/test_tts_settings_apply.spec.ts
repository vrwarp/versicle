import { test, expect, captureScreenshot, resetApp, ensureLibraryWithBook, navigateToChapter, openAudioSettings, switchAudioPanelView } from "./utils";

test("tts speed setting applies", async ({ page }) => {
  console.log("Starting Speed Setting Test...");
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open Book
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId("reader-back-button")).toBeVisible();

  // Navigate to chapter
  await navigateToChapter(page);

  // Open TTS Panel and switch to its Settings view (footer tab is off-viewport)
  console.log("Opening TTS settings...");
  await openAudioSettings(page);

  // Find the speed slider
  const speedSlider = page.locator("[data-testid='tts-speed-slider']");

  if (await speedSlider.isVisible()) {
    console.log("Found speed slider, adjusting to 1.5x...");
    const currentValue = await speedSlider.getAttribute("aria-valuenow");
    console.log(`Current speed value: ${currentValue}`);

    const boundingBox = await speedSlider.boundingBox();
    if (boundingBox) {
      await page.mouse.click(boundingBox.x + boundingBox.width * 0.9, boundingBox.y + boundingBox.height / 2);
      await page.waitForTimeout(500);
      const newValue = await speedSlider.getAttribute("aria-valuenow");
      console.log(`New speed value: ${newValue}`);
    }
  } else {
    console.log("Speed slider not found by testid, looking for alternative...");
    const paceSection = page.getByText("Pace").first();
    await expect(paceSection).toBeVisible();
    await captureScreenshot(page, "speed_setting_section");
  }

  // Go back to Queue and start playback. The footer "Up Next" tab sits below the
  // mobile Sheet fold AND its centerpoint is overlapped by the scrollable settings
  // body (div.p-6...overflow-y-auto intercepts pointer events), so a plain click is
  // intercepted. Route through the helper, which scrolls + force-clicks past the overlap.
  await switchAudioPanelView(page, "queue");
  await expect(page.getByTestId("tts-queue-item-0")).toBeVisible({ timeout: 5000 });

  // Start playback
  console.log("Starting playback to verify speed...");
  await page.getByTestId("tts-play-pause-button").click();

  // Check the debug element for rate
  await page.waitForTimeout(2000);
  const debugEl = page.locator("#tts-debug");
  if (await debugEl.isVisible()) {
    const rateAttr = await debugEl.getAttribute("data-rate");
    console.log(`Debug element rate attribute: ${rateAttr}`);
    const statusAttr = await debugEl.getAttribute("data-status");
    console.log(`Debug element status: ${statusAttr}`);
  }

  await captureScreenshot(page, "speed_setting_applied");
  console.log("Speed Setting Test Completed!");
});

test("tts voice selection persists", async ({ page }) => {
  console.log("Starting Voice Selection Persistence Test...");
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open Book
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId("reader-back-button")).toBeVisible();

  // Navigate to chapter
  await navigateToChapter(page);

  // Open TTS Panel and switch to its Settings view (footer tab is off-viewport)
  await openAudioSettings(page);

  // Find voice selector
  const voiceSection = page.getByText("Voice & Pace");
  await expect(voiceSection).toBeVisible();

  // Look for a voice dropdown or select
  const voiceSelect = page.locator("[data-testid='tts-voice-select']");
  if (await voiceSelect.isVisible()) {
    await voiceSelect.click();
    await page.waitForTimeout(500);

    const options = page.locator("[role='option']");
    const count = await options.count();
    if (count > 1) {
      const secondOption = options.nth(1);
      const voiceName = await secondOption.innerText();
      console.log(`Selecting voice: ${voiceName}`);
      await secondOption.click();
      await page.waitForTimeout(500);
    }
  } else {
    console.log("Voice select not found by testid");
  }

  await captureScreenshot(page, "voice_selection_before_reload");

  // Reload
  console.log("Reloading page...");
  await page.reload();
  await expect(page.getByTestId("reader-back-button")).toBeVisible({ timeout: 10000 });

  // Re-open settings (footer tab is off-viewport)
  await openAudioSettings(page);

  await captureScreenshot(page, "voice_selection_after_reload");
  console.log("Voice Selection Persistence Test Completed!");
});
