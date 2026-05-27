import { test, expect } from "./utils";
import { captureScreenshot, resetApp, ensureLibraryWithBook, getReaderFrame } from "./utils";

test("popover edge collision", async ({ page }) => {
  console.log("Starting Selection Verification (formerly Edge Collision)...");

  // Set a mobile viewport
  await page.setViewportSize({ width: 375, height: 812 });

  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open Book
  const bookCard = page.locator("[data-testid^='book-card-']").first();
  await expect(bookCard).toBeVisible({ timeout: 5000 });
  await bookCard.click();

  await expect(page.getByTestId("reader-back-button")).toBeVisible({ timeout: 5000 });

  // Wait for iframe content
  await page.waitForTimeout(2000);
  const frame = getReaderFrame(page);
  if (!frame) {
    throw new Error("Reader iframe not found");
  }
  await frame.locator("body").waitFor({ timeout: 5000 });

  // Wait for layout to stabilize
  await page.waitForTimeout(2000);

  console.log("Step 1: Selecting text");

  // Simulate a selection event
  await frame.locator("body").evaluate(() => {
    // Create a dummy element
    const dummy = document.createElement('span');
    dummy.innerText = "Selection Target";
    dummy.style.position = 'fixed';
    dummy.style.right = '0px';
    dummy.style.top = '100px';
    document.body.appendChild(dummy);

    const range = document.createRange();
    range.selectNodeContents(dummy);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }

    document.dispatchEvent(new MouseEvent('mouseup', {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100
    }));
  });

  // Expect Compass Pill Annotation Mode to appear
  const annotationPill = page.getByTestId("compass-pill-annotation");
  await expect(annotationPill).toBeVisible({ timeout: 5000 });

  // Verify buttons exist in the bar
  await expect(page.getByTestId("popover-copy-button")).toBeVisible();
  await expect(page.getByTestId("popover-add-note-button")).toBeVisible();

  await captureScreenshot(page, "annotation_pill_visible");
  console.log("Selection Verification Passed!");
});
