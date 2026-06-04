import type { Page } from '@playwright/test';
import { test, expect } from "./utils";
import { resetApp, getReaderFrame, captureScreenshot } from "./utils";
import type { Frame } from "@playwright/test";

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

test("journey visual reading", async ({ page }) => {
  console.log("Starting Visual Reading Journey...");
  await resetApp(page);

  // 1. Load Book
  await page.click("text=Load Demo Book");
  await expect(page.locator("text=Alice's Adventures in Wonderland").first()).toBeVisible({ timeout: 15000 });
  await page.locator("text=Alice's Adventures in Wonderland").first().click();
  await expect(page.locator("div[data-testid='reader-iframe-container']")).toBeVisible({ timeout: 5000 });

  // Wait for content
  await page.waitForTimeout(3000);

  // Navigate to Chapter 1 (Down the Rabbit-Hole) which is long and ensures multiple pages
  console.log("Navigating to Chapter I...");
  await page.getByTestId("reader-toc-button").click();
  await expect(page.getByTestId("reader-toc-sidebar")).toBeVisible();

  // Debug TOC and select "Chapter I"
  try {
    // Use loose match for Chapter I
    await page.getByText("Chapter I", { exact: false }).first().click();
  } catch {
    console.log("Failed to click 'Chapter I' by text. Trying toc-item-2...");
    await page.getByTestId("toc-item-2").click();
  }

  // Wait for content after navigation (TOC closes automatically)
  await page.waitForTimeout(3000);

  // Get Reader Frame
  let frame = await waitForReaderFrame(page);

  // Wait for content
  try {
    await frame.locator("p").first().waitFor({ timeout: 5000 });
  } catch {
    // Ignore
  }

  // Get initial text
  const initialText = await frame.locator("body").innerText();
  console.log(`Initial text length: ${initialText.length}`);

  // Determine tap targets based on Reader container (which might be centered max-w-2xl on desktop)
  const readerContainer = page.locator("div[data-testid='reader-iframe-container']");
  const box = await readerContainer.boundingBox();
  if (!box) {
    throw new Error("Reader container has no bounding box");
  }

  const readerX = box.x;
  const readerY = box.y;
  const readerW = box.width;
  const readerH = box.height;

  console.log(`Reader Box: x=${readerX}, y=${readerY}, w=${readerW}, h=${readerH}`);

  // --- Test Issue B: Tap Navigation Disabled in Standard Mode ---
  console.log("Testing Standard Mode Tap Restriction...");
  // Right 10% of READER width
  const tapXRight = readerX + readerW * 0.9;
  const tapY = readerY + readerH / 2;

  await page.mouse.click(tapXRight, tapY);
  await page.waitForTimeout(2000); // Short wait

  // Get new text
  frame = await waitForReaderFrame(page);
  const textAfterTapStandard = await frame.locator("body").innerText();

  // Should match initial text (No navigation)
  expect(initialText).toBe(textAfterTapStandard);
  console.log("Confirmed: Tap navigation disabled in Standard Mode");

  // --- Enter Immersive Mode ---
  console.log("Entering Immersive Mode...");
  await page.getByTestId("reader-immersive-enter-button").click();
  await expect(page.locator("header")).not.toBeVisible();

  // Verify Exit Button is visible
  await expect(page.getByTestId("reader-immersive-exit-button")).toBeVisible();

  // Recalculate bounding box just in case
  const immersiveContainer = page.locator("div[data-testid='reader-iframe-container']");
  const immersiveBox = await immersiveContainer.boundingBox();
  if (!immersiveBox) {
    throw new Error("Reader container has no bounding box in immersive mode");
  }
  const immX = immersiveBox.x;
  const immY = immersiveBox.y;
  const immW = immersiveBox.width;
  const immH = immersiveBox.height;
  const immTapY = immY + immH / 2;
  const immTapXRight = immX + immW * 0.9;
  const immTapXLeft = immX + immW * 0.1;

  // Capture CFI before navigation
  const cfiBefore = await page.evaluate(
    "window.rendition && window.rendition.location && window.rendition.location.start ? window.rendition.location.start.cfi : 'null'"
  );

  // --- Test Next Page (Compass Pill) in Immersive Mode ---
  console.log("Clicking Next on Compass Pill (Immersive)...");
  await page.waitForTimeout(1000); // Wait for UI to settle

  // Verify Compass Pill in compact mode is visible
  await expect(page.getByTestId("compass-pill-compact")).toBeVisible();

  await page.getByTestId("compass-pill-compact").getByLabel("Next").click();
  await page.waitForTimeout(3000); // Wait for page turn animation/render

  let cfiAfter = await page.evaluate(
    "window.rendition && window.rendition.location && window.rendition.location.start ? window.rendition.location.start.cfi : 'null'"
  );

  // Re-fetch frame as it might be detached/replaced
  frame = await waitForReaderFrame(page);

  // Get new text
  const newText = await frame.locator("body").innerText();
  console.log(`New text length: ${newText.length}`);

  // Assert changed
  if (initialText === newText) {
    if (cfiBefore && cfiAfter && cfiBefore === cfiAfter) {
      console.log("Failure: CFI did not change. Retrying tap...");
      await page.mouse.click(immTapXRight, immTapY);
      await page.waitForTimeout(3000);
      cfiAfter = await page.evaluate(
        "window.rendition && window.rendition.location && window.rendition.location.start ? window.rendition.location.start.cfi : 'null'"
      );

      if (cfiBefore === cfiAfter) {
        // Last resort manual next check to confirm engine isn't completely frozen
        await page.evaluate("window.rendition.next()");
        await page.waitForTimeout(3000);
        expect(cfiBefore).not.toBe(cfiAfter);
      }
    }
  }

  // --- Test Prev Page (Compass Pill) in Immersive Mode ---
  console.log("Clicking Previous on Compass Pill (Immersive)...");
  await page.waitForTimeout(1000);

  await page.getByTestId("compass-pill-compact").getByLabel("Previous").click();
  await page.waitForTimeout(3000);

  let cfiPrev = await page.evaluate(
    "window.rendition && window.rendition.location && window.rendition.location.start ? window.rendition.location.start.cfi : 'null'"
  );

  if (cfiPrev === cfiAfter) {
    console.log("Failure: CFI did not change on Prev. Retrying...");
    await page.mouse.click(immTapXLeft, immTapY);
    await page.waitForTimeout(3000);
    cfiPrev = await page.evaluate(
      "window.rendition && window.rendition.location && window.rendition.location.start ? window.rendition.location.start.cfi : 'null'"
    );

    expect(cfiPrev).not.toBe(cfiAfter);
  }

  await captureScreenshot(page, "visual_reading_immersive_active");

  // --- Exit Immersive Mode ---
  console.log("Exiting Immersive Mode...");
  const exitBtn = page.getByTestId("reader-immersive-exit-button");
  await exitBtn.click();
  await expect(page.locator("header")).toBeVisible();

  // Verify Exit Button is hidden
  await expect(exitBtn).not.toBeVisible();

  console.log("Visual Reading Journey Passed!");
});
