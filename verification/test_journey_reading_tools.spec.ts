import type { Page } from '@playwright/test';
import { test, expect } from "./utils";
import { resetApp, ensureLibraryWithBook, captureScreenshot, navigateToChapter, getReaderFrame, waitForPersistedWrites } from "./utils";
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

test("journey reading tools", async ({ page }) => {
  console.log("Starting Reading Tools Journey (Annotations & Highlight Play)...");
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open Book
  console.log("Clicking book card...");
  await page.locator("[data-testid^='book-card-']").first().click();

  console.log(`Current URL: ${page.url}`);
  await expect(page.getByTestId("reader-view")).toBeVisible({ timeout: 15000 });
  console.log("Reader View is visible");

  await expect(page.getByTestId("reader-back-button")).toBeVisible({ timeout: 15000 });

  // Wait for iframe content
  let frame = await waitForReaderFrame(page);

  await navigateToChapter(page);
  frame = await waitForReaderFrame(page);
  await page.waitForTimeout(2000);

  // Helper script to select text
  // Helper to select text inside the iframe
  const selectText = async (skipCount: number): Promise<boolean> => {
    return await frame.locator("body").evaluate((bodyEl, skip) => {
      try {
        const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT, null);
        let node = walker.nextNode();
        let found = 0;
        while (node) {
          if (node.textContent && node.textContent.trim().length > 20) {
            if (found >= skip) {
              break;
            }
            found++;
          }
          node = walker.nextNode();
        }

        if (node) {
          const range = document.createRange();
          range.setStart(node, 0);
          range.setEnd(node, 10);
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
          return true;
        }
        return false;
      } catch {
        return false;
      }
    }, skipCount);
  };

  // 1. Create Highlight
  console.log("Creating Highlight...");
  let selectionSuccess = await selectText(0);
  if (!selectionSuccess) {
    throw new Error("Could not select text for highlighting.");
  }

  // Expect Compass Pill Annotation Mode
  await expect(page.getByTestId("compass-pill-annotation")).toBeVisible({ timeout: 5000 });

  // Click Yellow Highlight
  const yellowButton = page.getByTestId("popover-color-yellow");
  await expect(yellowButton).toBeVisible({ timeout: 3000 });
  await yellowButton.click();

  // Expect Annotation Mode to close
  await expect(page.getByTestId("compass-pill-annotation")).not.toBeVisible({ timeout: 5000 });

  await captureScreenshot(page, "tools_1_highlight_created");

  // 2. Highlight Play (TTS)
  console.log("Testing Highlight Play...");
  // Select DIFFERENT text (skip the first one we just highlighted)
  selectionSuccess = await selectText(1);
  if (!selectionSuccess) {
    // Fallback: maybe navigate to next page?
    console.log("Could not find second text node, trying next page...");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(1000);
    selectionSuccess = await selectText(0);
    if (!selectionSuccess) {
      throw new Error("Could not select text for play.");
    }
  }

  // Expect Compass Pill Annotation Mode
  await expect(page.getByTestId("compass-pill-annotation")).toBeVisible({ timeout: 5000 });

  // Check for Play Button (aria-label="Play from here")
  const playBtn = page.getByRole("button", { name: "Play from here" });
  await expect(playBtn).toBeVisible({ timeout: 3000 });

  // Click Play Button
  console.log("Clicking Play button...");
  await playBtn.click();

  // Verify Playback Started
  // Check the debug element from mock TTS
  const debug = page.locator("#tts-debug");
  await expect(debug).toBeVisible();
  await expect(debug).toHaveAttribute("data-status", /start|speaking/, { timeout: 10000 });

  await captureScreenshot(page, "tools_2_play_started");

  // 3. Reload Page (Persistence Check)
  // Drain the debounced Yjs→IndexedDB write first: the annotation is created
  // synchronously in the store but its persist is debounced (~200ms y-idb), so a
  // reload before the flush tears the page down with the annotation unpersisted —
  // it never reapplies and the sidebar is empty after reload.
  await waitForPersistedWrites(page);
  console.log("Reloading page to check highlight persistence...");
  await page.reload();

  // Wait for book to reload (WebKit reader re-init lags under full-suite parallel load)
  await expect(page.getByTestId("reader-back-button")).toBeVisible({ timeout: 25000 });
  frame = await waitForReaderFrame(page);
  await page.waitForTimeout(2000);

  // 4. Verify Highlight Persisted
  console.log("Verifying annotations reapplied after reload...");
  // Check via sidebar
  await page.getByTestId("reader-annotations-button").click();
  await expect(page.getByTestId("reader-annotations-sidebar")).toBeVisible({ timeout: 5000 });
  await expect(page.locator("li[data-testid^='annotation-item-']").first()).toBeVisible({ timeout: 5000 });

  await captureScreenshot(page, "tools_3_sidebar_check");

  // 5. Verify Sidebar Closing via Back Button (New Feature)
  console.log("Verifying Sidebar Back Navigation...");
  // Annotations sidebar is currently open. Pressing back should close it.
  await page.goBack();
  await expect(page.getByTestId("reader-annotations-sidebar")).not.toBeVisible({ timeout: 2000 });
  // Ensure we are still in the reader
  await expect(page.getByTestId("reader-view")).toBeVisible();

  // Test for TOC Sidebar
  await page.getByTestId("reader-toc-button").click();
  await expect(page.getByTestId("reader-toc-sidebar")).toBeVisible({ timeout: 2000 });
  await page.goBack();
  await expect(page.getByTestId("reader-toc-sidebar")).not.toBeVisible({ timeout: 2000 });
  await expect(page.getByTestId("reader-view")).toBeVisible();

  // Test for Search Sidebar
  await page.getByTestId("reader-search-button").click();
  await expect(page.getByTestId("reader-search-sidebar")).toBeVisible({ timeout: 2000 });
  await page.goBack();
  await expect(page.getByTestId("reader-search-sidebar")).not.toBeVisible({ timeout: 2000 });
  await expect(page.getByTestId("reader-view")).toBeVisible();

  console.log("Reading Tools Journey Passed!");
});
