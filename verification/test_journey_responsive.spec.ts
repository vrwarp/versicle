import { test, expect } from "./utils";
import { resetApp, ensureLibraryWithBook, captureScreenshot, navigateToChapter } from "./utils";

const viewports = [
  { name: "mobile_small", width: 320, height: 568 },
  { name: "mobile_standard", width: 375, height: 667 },
  { name: "mobile_large", width: 414, height: 896 },
  { name: "tablet_portrait", width: 768, height: 1024 },
  { name: "tablet_landscape", width: 1024, height: 768 },
  { name: "desktop_small", width: 1280, height: 800 },
  { name: "desktop_large", width: 1920, height: 1080 },
];

for (const vp of viewports) {
  test(`responsive library: ${vp.name}`, async ({ page }) => {
    console.log(`Starting Responsive Library: ${vp.name}...`);
    await resetApp(page);
    await ensureLibraryWithBook(page);

    await page.setViewportSize({ width: vp.width, height: vp.height });
    // Wait for layout shift
    await page.waitForTimeout(1000);

    await expect(page.getByTestId("library-view")).toBeVisible();
    await captureScreenshot(page, `responsive_library_${vp.name}`);
  });

  test(`responsive reader: ${vp.name}`, async ({ page }) => {
    console.log(`Starting Responsive Reader: ${vp.name}...`);
    await resetApp(page);
    await ensureLibraryWithBook(page);

    await page.locator("[data-testid^='book-card-']").first().click();
    // Wait for reader
    await expect(page.getByTestId("reader-view")).toBeVisible();

    // Navigate to a middle chapter to verify text layout
    await navigateToChapter(page);

    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(1000);
    await captureScreenshot(page, `responsive_reader_${vp.name}`);
  });
}
