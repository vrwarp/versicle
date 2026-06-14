import { test, expect } from "./utils";
import { resetApp, ensureLibraryWithBook, captureScreenshot, openAudioSettings } from "./utils";

test("lexicon trace", async ({ page }) => {
  console.log("Starting Lexicon Trace Test...");
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open Book
  console.log("Opening book...");
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page).toHaveURL(/.*\/read\/.*/);

  // Wait for book to load
  await page.waitForTimeout(2000);

  // Open Audio Deck -> Settings -> Lexicon.
  // The audio deck is a right-side Radix Sheet; its "Settings" footer tab
  // (tts-settings-tab-btn) sits below the fold and must be scrolled into view
  // before clicking, otherwise the click reports "outside of viewport".
  console.log("Opening Pronunciation Lexicon...");
  await openAudioSettings(page);
  await page.getByText("Manage Pronunciation Rules").click();

  // 1. Add Rule 1: Hello -> Hi
  console.log("Adding Rule 1...");
  await page.getByTestId("lexicon-add-rule-btn").click();
  await page.getByTestId("lexicon-input-original").fill("Hello");
  await page.getByTestId("lexicon-input-replacement").fill("Hi");
  await page.getByTestId("lexicon-save-rule-btn").click();

  // 2. Add Rule 2: World -> Earth
  console.log("Adding Rule 2...");
  await page.getByTestId("lexicon-add-rule-btn").click();
  await page.getByTestId("lexicon-input-original").fill("World");
  await page.getByTestId("lexicon-input-replacement").fill("Earth");
  await page.getByTestId("lexicon-save-rule-btn").click();

  // 3. Test Trace
  console.log("Testing Trace...");
  const testInput = page.getByTestId("lexicon-test-input");
  await testInput.fill("Hello World");

  // Click "All Rules"
  await page.getByTestId("lexicon-test-all-btn").click();

  // Verify Final Output
  console.log("Verifying Output...");
  await expect(page.getByText("Processed:")).toBeVisible();
  // "Hi Earth" appears in both "Processed" and the Trace.
  // Processed output appears first in the DOM.
  await expect(page.getByText("Hi Earth").first()).toBeVisible();

  // Verify Trace Steps
  console.log("Verifying Trace Steps...");
  await expect(page.getByText("Transformation Steps")).toBeVisible();

  // Check for trace items
  // We expect to see "Hello -> Hi" and "World -> Earth"
  await expect(page.getByText("Hello → Hi")).toBeVisible();
  await expect(page.getByText("World → Earth")).toBeVisible();

  // Check intermediate states in trace
  // "Hi World" (result of first rule)
  await expect(page.getByText("Hi World")).toBeVisible();

  // 4. Test Bible Rule Trace
  console.log("Testing Bible Rule Trace...");
  await testInput.fill("Gen. 1");
  await page.getByTestId("lexicon-test-all-btn").click();

  // Verify Bible Rule Badge
  await expect(page.getByText("Bible", { exact: true })).toBeVisible();
  // Verify Rule Display
  // The regex for Genesis is complex, so we just check the replacement
  await expect(page.getByText("→ Genesis")).toBeVisible();

  // Scroll to the bottom to ensure the trace is fully visible in the screenshot
  await page.getByTestId("lexicon-list-container").evaluate((el) => (el.scrollTop = el.scrollHeight));

  await captureScreenshot(page, "lexicon_trace_verified");
  console.log("Lexicon Trace Test Passed!");
});
