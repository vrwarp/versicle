import { test, expect } from "./utils";
import { resetApp, ensureLibraryWithBook } from "./utils";

test("journey tts persistence", async ({ page }) => {
  console.log("STARTING TEST V3");
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // 1. Open the book
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId("reader-view")).toBeVisible({ timeout: 10000 });

  // 2. Go to chapter
  await page.getByTestId("reader-toc-button").click();
  await expect(page.getByTestId("reader-toc-sidebar")).toBeVisible();
  // Click 3rd item (Chapter II)
  await page.getByRole("button", { name: "Chapter II." }).first().click();

  await page.waitForTimeout(3000);

  // 4. Open tts panel
  await page.getByTestId("reader-audio-button").click();
  await expect(page.getByTestId("tts-queue")).toBeVisible();

  // 5. Play
  await page.getByTestId("tts-play-pause-button").click();

  // 6. Wait
  await page.waitForTimeout(3000);

  // Check pause state by aria-label
  const btn = page.getByTestId("tts-play-pause-button");
  await expect(btn).toHaveAttribute("aria-label", "Pause");

  // 7. Pause
  await btn.click();
  await expect(btn).toHaveAttribute("aria-label", "Play");

  // 8. Refresh
  console.log("REFRESHING");
  await page.reload();
  await expect(page.getByTestId("reader-view")).toBeVisible({ timeout: 10000 });

  // 9. Check persistence
  await page.getByTestId("reader-audio-button").click();
  await expect(page.getByTestId("tts-queue")).toBeVisible();

  const queueItems = page.locator("[data-testid^='tts-queue-item-']");
  await expect(queueItems.first()).toBeVisible();
  const count = await queueItems.count();
  console.log(`Queue items found: ${count}`);
  expect(count).toBeGreaterThan(0);
});
