import { Page } from '@playwright/test';
import { test, expect } from "./utils";
import { resetApp, ensureLibraryWithBook, captureScreenshot, navigateToChapter, getReaderFrame } from "./utils";
import { Frame } from "@playwright/test";

async function waitForReaderFrame(page: Page): Promise<Frame> {
  for (let i = 0; i < 20; i++) {
    const frame = getReaderFrame(page);
    if (frame) {
      await frame.locator("body").waitFor({ timeout: 5000 }).catch(() => {});
      return frame;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("Timeout waiting for reader iframe");
}

test("visual settings journey", async ({ page }) => {
  console.log("Starting Visual Settings Journey...");
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open Book
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page).toHaveURL(/.*\/read\/.*/);
  await page.waitForTimeout(2000);

  // Navigate to text page first (Chapter 5)
  console.log("Navigating to text page via TOC...");
  await navigateToChapter(page);
  // Ensure focus
  await page.locator('[data-testid="reader-iframe-container"]').click();

  // Open Visual Settings Popover
  console.log("Opening Visual Settings...");
  const visualBtn = page.getByTestId("reader-visual-settings-button");
  await visualBtn.click();

  // Verify Popover content
  await expect(page.getByText("Ambience")).toBeVisible();
  await expect(page.getByText("Legibility")).toBeVisible();
  await expect(page.getByText("Layout")).toBeVisible();
  await captureScreenshot(page, "visual_settings_01_open");

  // 0. Test Default Layout Selection (Paginated)
  console.log("Testing Default Layout Selection (Paginated)...");
  const paginatedTab = page.getByRole("tab", { name: "Paginated" });
  await expect(paginatedTab).toBeVisible();

  // Check data-state attribute
  const paginatedState = await paginatedTab.getAttribute("data-state");
  console.log(`Default Paginated State: ${paginatedState}`);
  expect(paginatedState).toBe("active");

  // 1. Test Theme Switching
  console.log("Testing Theme Switching (Sepia)...");
  const sepiaBtn = page.locator('button[aria-label="Select Sepia theme"]');
  await sepiaBtn.click();
  await page.waitForTimeout(1000);
  await captureScreenshot(page, "visual_settings_02_sepia");

  // Verify Outer UI Theme (ThemeSynchronizer)
  const mainHtmlClass = await page.locator("html").getAttribute("class");
  console.log(`Main HTML Class: ${mainHtmlClass}`);

  // Verify Button State
  const isSepiaActive = await sepiaBtn.evaluate((el) => el.classList.contains("ring-2"));
  console.log(`Sepia Button Active: ${isSepiaActive}`);

  expect(mainHtmlClass).toContain("sepia");
  expect(isSepiaActive).toBe(true);

  console.log("Testing Theme Switching (Dark)...");
  const darkBtn = page.locator('button[aria-label="Select Dark theme"]');
  await darkBtn.click();
  await page.waitForTimeout(1000);
  await captureScreenshot(page, "visual_settings_03_dark");

  // Verify Outer UI Theme (Dark)
  const mainHtmlClassDark = await page.locator("html").getAttribute("class");
  console.log(`Main HTML Class (Dark): ${mainHtmlClassDark}`);

  const isDarkActive = await darkBtn.evaluate((el) => el.classList.contains("ring-2"));
  console.log(`Dark Button Active: ${isDarkActive}`);

  expect(mainHtmlClassDark).toContain("dark");
  expect(isDarkActive).toBe(true);

  // 2. Test Font Size
  console.log("Testing Font Size...");
  const increaseFontBtn = page.locator('button[aria-label="Increase font size"]');
  await increaseFontBtn.click();
  await increaseFontBtn.click();
  await page.waitForTimeout(1000);

  // Check font size in iframe
  const frame = await waitForReaderFrame(page);

  // Wait for body
  await frame.locator("body").waitFor({ timeout: 2000 });

  const fontSize = await frame.locator("body").evaluate((element) => getComputedStyle(element).fontSize);
  console.log(`Font Size Style: ${fontSize}`);

  // 3. Test Layout (Scrolled)
  console.log("Testing Layout Switching (Scrolled)...");
  // Tabs trigger
  const scrolledTab = page.getByRole("tab", { name: "Scrolled" });
  await scrolledTab.click();
  await page.waitForTimeout(2000);
  await captureScreenshot(page, "visual_settings_04_scrolled");

  // Close the popover to see the content clearly
  await page.mouse.click(10, 10);
  await page.waitForTimeout(500);

  // Verify Compass Pill is visible (Audio HUD)
  await expect(page.getByTestId("compass-pill-active")).toBeVisible();

  // Verify we can scroll to the bottom and text is not obscured by the pill
  console.log("Scrolling to bottom to verify padding...");

  const scrolledFrame = await waitForReaderFrame(page);

  // Scroll the iframe body to the bottom
  await scrolledFrame.locator("html").evaluate((el) => el.ownerDocument.defaultView?.scrollTo(0, el.ownerDocument.body.scrollHeight));
  await page.waitForTimeout(1000);

  // Verify that the iframe has spacer div applied
  const spacerHeight = await scrolledFrame.locator("#reader-bottom-spacer").evaluate((el) => getComputedStyle(el).height);
  console.log(`Spacer Height: ${spacerHeight}`);

  // It should be 150px
  expect(spacerHeight).toBe("150px");

  await captureScreenshot(page, "visual_settings_05_scrolled_bottom");

  console.log("Visual Settings Journey Passed!");
});
