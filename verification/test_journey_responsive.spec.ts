import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./utils";
import { resetApp, ensureLibraryWithBook, captureScreenshot, navigateToChapter, waitForReaderReady } from "./utils";

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
    // Wait for layout shift: the library is CSS-only, so the resize has landed
    // once the page sees the new width and breakpoint transitions have finished.
    await page
      .waitForFunction(
        (w) =>
          window.innerWidth === w &&
          document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().endTime === Infinity),
        vp.width,
        { timeout: 5000 }
      )
      .catch(() => {});

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

/**
 * iPad home-screen (standalone PWA) chrome: the status bar and home indicator
 * are drawn OVER the page on iPadOS. index.html declares viewport-fit=cover
 * so WebKit reports them through env(safe-area-inset-*), which src/index.css
 * maps onto the --safe-area-inset-* custom properties every edge-pinned
 * surface offsets by. Chromium has no system chrome, so the journey injects
 * the insets iPadOS reports (24px status bar, 20px home indicator) through
 * those same properties and pins that nothing interactive sits under them.
 * The iPad standalone floor (src/app/boot/standaloneChrome.ts +
 * `html[data-standalone-platform="ipados"]`) is pinned separately: with the
 * attribute alone the top clearance must still be 24px even when the
 * reported inset is 0 (WebKit bug 301994 family).
 */
const IPAD_INSETS = { top: 24, bottom: 20 };
const ipadViewports = [
  { name: "ipad_portrait", width: 820, height: 1180 },
  { name: "ipad_landscape", width: 1180, height: 820 },
];

async function simulateIpadStandalone(page: Page, insets: { top: number; bottom: number } | null) {
  await page.evaluate((insets) => {
    const root = document.documentElement;
    root.setAttribute("data-standalone-platform", "ipados");
    if (insets) {
      root.style.setProperty("--safe-area-inset-top", `${insets.top}px`);
      root.style.setProperty("--safe-area-inset-bottom", `${insets.bottom}px`);
    } else {
      root.style.removeProperty("--safe-area-inset-top");
      root.style.removeProperty("--safe-area-inset-bottom");
    }
  }, insets);
}

async function expectClearOfInsets(locator: Locator, viewportHeight: number) {
  const box = await locator.boundingBox();
  expect(box, `${await locator.getAttribute("data-testid")} has a box`).not.toBeNull();
  expect(box!.y, "clear of the status bar").toBeGreaterThanOrEqual(IPAD_INSETS.top);
  expect(box!.y + box!.height, "clear of the home indicator").toBeLessThanOrEqual(viewportHeight - IPAD_INSETS.bottom);
}

for (const vp of ipadViewports) {
  test(`ipad standalone safe areas: ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await resetApp(page);
    await ensureLibraryWithBook(page);
    await simulateIpadStandalone(page, IPAD_INSETS);

    // Library: the whole page scrolls, so its header clears the bar via the
    // .main_layout shell padding.
    await expect(page.getByTestId("library-view")).toBeVisible();
    await expectClearOfInsets(page.getByTestId("header-settings-button"), vp.height);
    await captureScreenshot(page, `ipad_standalone_library_${vp.name}`);

    await page.locator("[data-testid^='book-card-']").first().click();
    await expect(page.getByTestId("reader-view")).toBeVisible();
    await waitForReaderReady(page);
    // The inline properties survive the in-app navigation (same document);
    // re-apply anyway so the assertion does not depend on that.
    await simulateIpadStandalone(page, IPAD_INSETS);

    // Reader header buttons (the reported overlap) and the fixed quick-actions
    // pill at the bottom.
    await expectClearOfInsets(page.getByTestId("reader-back-button"), vp.height);
    await expectClearOfInsets(page.getByTestId("reader-settings-button"), vp.height);
    await expectClearOfInsets(page.getByRole("region", { name: "Quick actions" }).locator("> div"), vp.height);
    // The reader column is the viewport minus the insets — nothing overflows
    // into a document scroll.
    const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(overflow, "reader shell fits the viewport").toBeLessThanOrEqual(0);
    await captureScreenshot(page, `ipad_standalone_reader_${vp.name}`);

    // The audio deck is a fixed right-hand Sheet: it must start below the bar.
    await page.getByTestId("reader-audio-button").click();
    const panel = page.getByTestId("tts-panel");
    await expect(panel).toBeVisible();
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
    await expectClearOfInsets(panel, vp.height);
    await captureScreenshot(page, `ipad_standalone_audio_sheet_${vp.name}`);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();

    // Immersive mode: the floating exit button sits inside the padded shell.
    await page.getByTestId("reader-immersive-enter-button").click();
    await expectClearOfInsets(page.getByTestId("reader-immersive-exit-button"), vp.height);
    await captureScreenshot(page, `ipad_standalone_immersive_${vp.name}`);
    await page.getByTestId("reader-immersive-exit-button").click();

    // Floor: attribute only (reported inset 0) still clears the 24px bar.
    await simulateIpadStandalone(page, null);
    const paddingTop = await page.locator(".main_layout").evaluate((el) => getComputedStyle(el).paddingTop);
    expect(paddingTop).toBe(`${IPAD_INSETS.top}px`);
    const backBox = await page.getByTestId("reader-back-button").boundingBox();
    expect(backBox!.y).toBeGreaterThanOrEqual(IPAD_INSETS.top);
  });
}
