import { test, expect } from "./utils";
import { captureScreenshot, resetApp } from "./utils";

test("piper provider selection", async ({ page }) => {
  await resetApp(page);

  // Mock voices.json to avoid external network dependency
  const mockVoices = {
    "en_US-lessac-high": {
      key: "en_US-lessac-high",
      name: "Lessac",
      language: {
        code: "en_US",
        family: "en",
        region: "US",
        name_native: "English",
        name_english: "English"
      },
      quality: "high",
      num_speakers: 1,
      speaker_id_map: {},
      files: {
        "en_US-lessac-high.onnx": { size_bytes: 10, md5_digest: "abc" },
        "en_US-lessac-high.onnx.json": { size_bytes: 10, md5_digest: "def" }
      }
    }
  };

  await page.route("**/voices.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockVoices)
    });
  });

  // Open settings
  await page.getByRole("button", { name: "Settings" }).click();

  // Go to TTS tab
  await page.getByRole("tab", { name: "TTS Engine" }).scrollIntoViewIfNeeded().catch(() => {});
  await page.getByRole("tab", { name: "TTS Engine" }).click();

  // Check provider dropdown (initially Web Speech)
  const selectTrigger = page.getByTestId("tts-provider-select");
  await expect(selectTrigger).toContainText("Web Speech (Local)");

  await selectTrigger.click();

  // Select Piper
  await page.getByRole("option", { name: "Piper (High Quality Local)" }).click();

  // Verify it is selected
  await expect(selectTrigger).toContainText("Piper");

  // Take screenshot
  await captureScreenshot(page, "piper_settings");
});
