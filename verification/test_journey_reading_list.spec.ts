import { test, expect } from "./utils";
import { resetApp, captureScreenshot } from "./utils";

test("reading list journey", async ({ page }) => {
  console.log("Starting Reading List Journey...");
  await resetApp(page);

  // 1. Upload Book
  console.log("Uploading book...");
  const fileInput = page.getByTestId("hidden-file-input");
  await fileInput.setInputFiles("verification/alice.epub");

  await expect(page.locator("[data-testid^='book-card-']").first()).toBeVisible();

  // 2. Open Book and Read
  console.log("Opening book...");
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId("reader-iframe-container")).toBeVisible();

  // Advance a page to record progress
  console.log("Reading...");
  await page.waitForTimeout(2000);
  await page.keyboard.press("ArrowRight");
  // Wait for debounce save (1s) + margin
  await page.waitForTimeout(2000);

  // 3. Go back to Library
  await page.getByTestId("reader-back-button").click();
  await expect(page.getByTestId("library-view")).toBeVisible();

  // 4. Open Settings -> Data Management -> View List
  console.log("Opening Reading List...");
  await page.getByTestId("header-settings-button").click();
  await page.getByRole("button", { name: "Data Management" }).click();
  await page.getByRole("button", { name: "View List" }).click();

  // 5. Verify Entry
  console.log("Verifying entry...");
  const readingListModal = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Reading List" }) });
  await expect(readingListModal).toBeVisible();

  // Check if Alice is there (inside the modal)
  await expect(readingListModal.getByText("Alice's Adventures in Wonderland")).toBeVisible();

  // Check for "Reading" status badge
  await expect(readingListModal.getByText("Reading", { exact: true })).toBeVisible();

  await captureScreenshot(page, "reading_list_view");

  console.log("Reading List Journey Passed!");
});
