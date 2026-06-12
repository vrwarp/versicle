import { test, expect } from "./utils";
import { resetApp, ensureLibraryWithBook } from "./utils";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("smart toc success", async ({ page }) => {
  console.log("Starting Smart TOC Success Journey...");
  // 1. Reset and Load
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // 2. Inject Mock Data for GenAI
  // We use real IDs from Alice in Wonderland (np-4 is Chapter 1)
  const mockResponse = [
    { id: "np-4", title: "AI Generated: The Rabbit Hole" },
    { id: "np-5", title: "AI Generated: Pool of Tears" },
  ];

  await page.evaluate(() => {
    localStorage.setItem(
      "genai-storage",
      JSON.stringify({
        state: { isEnabled: true, apiKey: "mock-key", model: "gemini-flash-lite-latest" },
        version: 0,
      })
    );
  });

  // Reload to pick up store changes
  await page.reload();

  // Wait for library to load
  await expect(page.getByTestId("library-view")).toBeVisible({ timeout: 10000 });

  // Install the GenAI mock through the typed test API (Phase 7: the
  // localStorage.mockGenAIResponse production seam is gone). Runtime-settable,
  // so post-reload installation is the supported timing.
  await page.evaluate((mockData) => {
    window.__versicleTest!.genai.setMock({ response: mockData });
  }, mockResponse);

  // 3. Open Reader
  // Ensure book is present (reload might have cleared state or DB latency)
  try {
    await page.locator('[data-testid^="book-card-"]').first().waitFor({ timeout: 10000 });
  } catch {
    console.log("Book card missing after reload in Success Scenario, ensuring library again...");
    await ensureLibraryWithBook(page);
    await page.locator('[data-testid^="book-card-"]').first().waitFor({ timeout: 30000 });
  }

  await page.locator('[data-testid^="book-card-"]').first().click();
  await expect(page.getByTestId("reader-view")).toBeVisible({ timeout: 20000 });

  // 4. Open TOC
  await page.getByTestId("reader-toc-button").click();
  await expect(page.getByTestId("reader-toc-sidebar")).toBeVisible();

  // 5. Enable Generated Titles
  // Before enabling, check original title exists
  await expect(page.getByText("CHAPTER I. Down the Rabbit-Hole")).toBeVisible();

  await page.locator("#synthetic-toc-mode").click();

  // Debug: capture UI state right after the switch click
  const dbgSuffix = page.viewportSize()?.width && page.viewportSize()!.width < 600 ? "mobile" : "desktop";
  await page.screenshot({ path: path.join(__dirname, `screenshots/debug_switch_click_success_${dbgSuffix}.png`) });

  // Log DOM state for diagnosis
  const domState = await page.evaluate(() => {
    const sw = document.getElementById("synthetic-toc-mode");
    const allBtns = Array.from(document.querySelectorAll("button")).map((b) => ({
      text: (b.textContent ?? "").trim().substring(0, 60),
      ariaLabel: b.getAttribute("aria-label"),
      role: b.getAttribute("role"),
      disabled: b.disabled,
    }));
    return {
      switchAriaChecked: sw?.getAttribute("aria-checked"),
      switchDataState: sw?.getAttribute("data-state"),
      allButtons: allBtns.slice(0, 30),
    };
  });
  console.log("DOM_STATE_AFTER_SWITCH:", JSON.stringify(domState, null, 2));

  // 6. Click Enhance
  const enhanceBtn = page.getByRole("button", { name: "Enhance Titles with AI" });
  await expect(enhanceBtn).toBeVisible();
  await enhanceBtn.click();

  // 7. Wait for Success Toast
  // TOC enhancement + persistence is slow on WebKit under full-suite load.
  await expect(page.getByText("Table of Contents enhanced successfully!")).toBeVisible({ timeout: 30000 });

  // 8. Verify Titles Updated
  // Check that the new titles are visible
  await expect(page.getByText("AI Generated: The Rabbit Hole")).toBeVisible();
  await expect(page.getByText("AI Generated: Pool of Tears")).toBeVisible();

  // Verify original title is GONE (or at least replaced in the list view)
  await expect(page.getByText("CHAPTER I. Down the Rabbit-Hole")).not.toBeVisible();

  const screenshotsDir = path.resolve(__dirname, "screenshots");
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }
  const suffix = page.viewportSize()?.width && page.viewportSize()!.width < 600 ? "mobile" : "desktop";
  await page.screenshot({ path: path.join(screenshotsDir, `smart_toc_success_${suffix}.png`) });
});

test("smart toc failure", async ({ page }) => {
  console.log("Starting Smart TOC Failure Journey...");

  // Setup
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // 1. Missing Key Scenario
  console.log("--- Scenario 1: Missing Key ---");
  await page.evaluate(() => {
    localStorage.setItem(
      "genai-storage",
      JSON.stringify({
        state: { isEnabled: true, apiKey: "", model: "gemini-flash-lite-latest" },
        version: 0,
      })
    );
  });
  await page.reload();

  // Ensure book is present (reload might have cleared state or DB latency)
  try {
    await page.locator('[data-testid^="book-card-"]').first().waitFor({ timeout: 10000 });
  } catch {
    console.log("Book card missing after reload, ensuring library again...");
    await ensureLibraryWithBook(page);
    await page.locator('[data-testid^="book-card-"]').first().waitFor({ timeout: 30000 });
  }

  await page.locator('[data-testid^="book-card-"]').first().click();
  await expect(page.getByTestId("reader-view")).toBeVisible({ timeout: 20000 });

  await page.getByTestId("reader-toc-button").click();
  await expect(page.getByTestId("reader-toc-sidebar")).toBeVisible();
  await page.locator("#synthetic-toc-mode").click();
  // Debug: capture state after switch click in failure scenario
  const failDbgSuffix = page.viewportSize()?.width && page.viewportSize()!.width < 600 ? "mobile" : "desktop";
  await page.screenshot({ path: path.join(__dirname, `screenshots/debug_switch_click_fail_${failDbgSuffix}.png`) });

  await page.getByRole("button", { name: "Enhance Titles with AI" }).click();

  const screenshotsDir = path.resolve(__dirname, "screenshots");
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }
  const suffix = page.viewportSize()?.width && page.viewportSize()!.width < 600 ? "mobile" : "desktop";

  // Expect error toast
  try {
    await expect(page.getByText("AI features are disabled or not configured")).toBeVisible({ timeout: 10000 });
  } catch (e) {
    console.log("Taking failure screenshot for Scenario 1...");
    await page.screenshot({ path: path.join(screenshotsDir, `smart_toc_failure_sc1_${suffix}.png`) });
    throw e;
  }

  // 2. Service Failure Scenario
  console.log("--- Scenario 2: Service Failure ---");
  // Reset history state to ensure sidebar is closed after reload
  await page.evaluate("history.replaceState(null, '')");
  await page.evaluate(() => {
    localStorage.setItem(
      "genai-storage",
      JSON.stringify({
        state: { isEnabled: true, apiKey: "mock-key", model: "gemini-flash-lite-latest" },
        version: 0,
      })
    );
  });
  await page.reload();

  // Ensure in reader
  try {
    await expect(page.getByTestId("reader-view")).toBeVisible({ timeout: 5000 });
  } catch {
    await page.locator('[data-testid^="book-card-"]').first().waitFor({ timeout: 30000 });
    await page.locator('[data-testid^="book-card-"]').first().click();
    await expect(page.getByTestId("reader-view")).toBeVisible({ timeout: 20000 });
  }

  // Phase 7: simulated service failure via the typed mock seam.
  await page.evaluate(() => {
    window.__versicleTest!.genai.setMock({ error: "Simulated GenAI Error" });
  });

  await page.getByTestId("reader-toc-button").click();
  await expect(page.getByTestId("reader-toc-sidebar")).toBeVisible();
  // The switch may already be ON (useSyntheticToc persisted from scenario 1). Click only if OFF.
  const sc2Switch = page.locator("#synthetic-toc-mode");
  if ((await sc2Switch.getAttribute("data-state")) !== "checked") {
    await sc2Switch.click();
  }
  await expect(page.getByRole("button", { name: "Enhance Titles with AI" })).toBeVisible({ timeout: 5000 });

  await page.getByRole("button", { name: "Enhance Titles with AI" }).click();

  // Check for success toast (false positive)
  if (await page.getByText("Table of Contents enhanced successfully!").isVisible()) {
    console.log("FAILURE: Got success toast instead of error! Chapters likely empty.");
  }

  // Expect failure toast
  try {
    await expect(page.getByText("Failed to enhance TOC")).toBeVisible({ timeout: 5000 });
  } catch (e) {
    console.log("Taking failure screenshot...");
    await page.screenshot({ path: path.join(screenshotsDir, `smart_toc_failure_debug_${suffix}.png`) });
    throw e;
  }

  await page.screenshot({ path: path.join(screenshotsDir, `smart_toc_failure_${suffix}.png`) });
});
