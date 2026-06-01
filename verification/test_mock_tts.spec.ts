import { Page } from '@playwright/test';
import { test, expect } from "./utils";

async function setupMockTts(page: Page) {
  await page.goto("/");
  // Wait for initial load
  await page.waitForTimeout(1000);

  // Wait for voices to load (signifies polyfill is active)
  try {
    await page.waitForFunction("window.speechSynthesis.getVoices().length > 0", { timeout: 5000 });
  } catch {
    console.log("Timeout waiting for voices, polyfill might not be injected.");
    const isMock = await page.evaluate("window.speechSynthesis.constructor.name === 'MockSpeechSynthesis'");
    console.log(`Is Mock Synthesis: ${isMock}`);
    throw e;
  }
}

test("mock tts sanity", async ({ page }) => {
  await setupMockTts(page);

  // Check that voices are loaded
  const voicesLen = await page.evaluate("window.speechSynthesis.getVoices().length");
  console.log(`Voices length: ${voicesLen}`);
  expect(voicesLen).toBeGreaterThan(0);

  // Speak
  await page.evaluate(() => {
    const u = new SpeechSynthesisUtterance("Hello world");
    u.rate = 0.5; // 800ms per word
    window.speechSynthesis.speak(u);
  });

  // Check debug output
  const debug = page.locator("#tts-debug");
  await expect(debug).toBeVisible();

  // Should see "Hello"
  await expect(debug).toHaveText("Hello", { timeout: 10000 });

  // Wait for completion "world" -> END
  await expect(debug).toHaveText("[[END]]", { timeout: 10000 });
});

test("mock tts pause resume", async ({ page }) => {
  await setupMockTts(page);

  const debug = page.locator("#tts-debug");

  // Speak a long sentence
  await page.evaluate(() => {
    const u = new SpeechSynthesisUtterance("One two three four five");
    u.rate = 0.5; // 800ms per word
    window.speechSynthesis.speak(u);
  });

  // Wait for first word
  await expect(debug).toHaveText("One", { timeout: 10000 });

  // Pause
  await page.evaluate("window.speechSynthesis.pause()");

  // Should show paused state
  await expect(debug).toHaveText("[[PAUSED]]", { timeout: 10000 });

  // Wait a bit
  await page.waitForTimeout(1000);
  await expect(debug).toHaveText("[[PAUSED]]");

  // Resume
  await page.evaluate("window.speechSynthesis.resume()");
  await expect(debug).toHaveText("[[RESUMED]]", { timeout: 10000 });

  // Should eventually reach "two"
  await expect(debug).toHaveText("two", { timeout: 10000 });

  // Finish
  await page.evaluate("window.speechSynthesis.cancel()");
  await expect(debug).toHaveText("[[CANCELED]]", { timeout: 10000 });
});

test("mock tts cancel", async ({ page }) => {
  await setupMockTts(page);

  const debug = page.locator("#tts-debug");

  await page.evaluate(() => {
    const u = new SpeechSynthesisUtterance("This should be canceled");
    u.rate = 0.5; // 800ms per word
    window.speechSynthesis.speak(u);
  });

  await expect(debug).toHaveText("This", { timeout: 10000 });

  await page.evaluate("window.speechSynthesis.cancel()");

  await expect(debug).toHaveText("[[CANCELED]]", { timeout: 10000 });

  // Wait to ensure no more words
  await page.waitForTimeout(2000);
  await expect(debug).toHaveText("[[CANCELED]]");
});
