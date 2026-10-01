import { test, expect } from "./utils";
import { resetApp, captureScreenshot } from "./utils";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("smart delete journey", async ({ page }) => {
  await resetApp(page);

  const demoEpubPath = path.resolve(__dirname, "alice.epub");

  // 1. Import Book
  console.log("Importing book...");
  await page.getByTestId("hidden-file-input").setInputFiles(demoEpubPath);

  // Wait for book to appear
  const bookCard = page.locator("[data-testid^='book-card-']").first();
  await expect(bookCard).toBeVisible({ timeout: 20000 });

  // 2. Offload Book
  console.log("Offloading book...");
  // Open menu (hover to show button, then click)
  await bookCard.hover();
  await page.getByTestId("book-context-menu-trigger").click();
  // Wait for menu animation: the item stops moving (was a fixed 1s sleep)
  await page
    .getByTestId("menu-offload")
    .elementHandle({ timeout: 5000 })
    .then((item) => item?.waitForElementState("stable", { timeout: 5000 }))
    .catch(() => {});

  // Click "Offload File"
  await page.getByTestId("menu-offload").click({ force: true });
  // Let the menu finish closing before the dialog it opened is confirmed. If
  // the dialog closes while the menu's exit animation still holds its layer,
  // Radix restores <body> to the menu's `pointer-events: none` and every later
  // click is swallowed (the old fixed 1s sleep here hid this).
  await page.getByTestId("menu-offload").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});

  // Confirm Offload
  const confirmBtn = page.getByTestId("confirm-offload");
  await expect(confirmBtn).toHaveCount(1);
  // Use JS click to bypass potential obstructions
  await page.evaluate("document.querySelector('[data-testid=\"confirm-offload\"]').click()");

  // 3. Verify Offloaded State
  await expect(page.getByTestId("offloaded-overlay")).toBeVisible({ timeout: 5000 });

  // Wait a moment for state update: the offload dialog closes once the offload
  // resolves, after the overlay shows (was a fixed 1s sleep)
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5000 }).catch(() => {});
  await captureScreenshot(page, "library_smart_delete_offloaded");

  // 5. Restore Book (Success Case)
  console.log("Restoring book...");
  // Trigger the restore flow by clicking the card (which is offloaded)
  await bookCard.click();

  // Wait for the dialog to appear
  await expect(page.getByText("Content Missing")).toBeVisible();

  // Click "Select File" to trigger the file chooser
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Select File" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(demoEpubPath);

  // Wait for restore to complete (loader or just state change)
  await expect(page.getByTestId("offloaded-overlay")).not.toBeVisible({ timeout: 5000 });

  await captureScreenshot(page, "library_smart_delete_restored");

  // 6. Verify Book Opens
  console.log("Opening book...");
  // Let the restored cover settle before the img probe below: its <img> renders
  // once the new cover URL resolves (was a fixed 3s sleep)
  await page
    .waitForFunction(() => {
      const img = document.querySelector("[data-testid^='book-card-'] img") as HTMLImageElement | null;
      return !!img && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 5000 })
    .catch(() => {});

  // Verify the book cover image no longer has the grayscale class (skip if no img, e.g. WebKit with no SW)
  const bookCoverImg = page.locator("[data-testid^='book-card-']").first().locator("img").first();
  if (await bookCoverImg.count() > 0) {
    await expect(bookCoverImg).not.toHaveClass(/.*grayscale.*/, { timeout: 5000 });
  }

  // Use a fresh locator to avoid any stale reference issues
  const freshBookCard = page.locator("[data-testid^='book-card-']").first();
  await freshBookCard.click();

  const reprocessingModal = page.getByText("Upgrading Book...");
  await page.waitForTimeout(500);

  if (await reprocessingModal.isVisible()) {
    console.log("Reprocessing modal appeared - waiting for completion...");
    await expect(reprocessingModal).not.toBeVisible({ timeout: 30000 });
  }

  // Should navigate to reader (either directly or after reprocessing)
  await expect(page).toHaveURL(/.*\/read\/.*/, { timeout: 15000 });
  await expect(page.getByTestId("reader-back-button")).toBeVisible({ timeout: 15000 });

  await captureScreenshot(page, "reader_smart_delete_success");
});
