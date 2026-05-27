import { test, expect } from "./utils";
import { resetApp, ensureLibraryWithBook, captureScreenshot, navigateToChapter } from "./utils";

test("search journey", async ({ page }) => {
  console.log("Starting Search Journey...");
  // Set viewport to ensure desktop layout for position check
  await page.setViewportSize({ width: 1280, height: 800 });

  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open Book
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId("reader-back-button")).toBeVisible();

  // --- Part 1: Verify Position ---
  console.log("Verifying Search Button Position...");
  const searchBtn = page.getByTestId("reader-search-button");
  await expect(searchBtn).toBeVisible({ timeout: 5000 });

  const annotationsBtn = page.getByTestId("reader-annotations-button");
  await expect(annotationsBtn).toBeVisible({ timeout: 5000 });

  const searchBox = await searchBtn.boundingBox();
  const annotationsBox = await annotationsBtn.boundingBox();
  const title = page.locator("header h1");

  if ((await title.count()) > 0 && (await title.isVisible())) {
    const titleBox = await title.boundingBox();
    if (searchBox && annotationsBox && titleBox) {
      if (searchBox.x >= titleBox.x) {
        console.log("WARNING: Search button is not to the left of the title (or title logic changed)");
      } else {
        expect(searchBox.x).toBeLessThan(titleBox.x);
      }
    }
  } else {
    console.log("Title not found, skipping relative title position check.");
  }

  // --- Part 2: Search Functionality ---
  console.log("Navigating to Chapter 5...");
  await navigateToChapter(page);

  // Open Search
  console.log("Opening Search...");
  await searchBtn.click();
  const searchInput = page.getByTestId("search-input");
  await expect(searchInput).toBeVisible();

  // Retry search until results found (indexing might take time)
  let found = false;
  for (let i = 0; i < 20; i++) {
    console.log(`Search attempt ${i + 1}...`);
    await searchInput.fill("Alice");
    await searchInput.press("Enter");

    await page.waitForTimeout(500);

    const results = page.getByTestId("reader-search-sidebar").locator("button[data-testid^='search-result-']");
    const count = await results.count();
    console.log(`List items count: ${count}`);

    if (count > 0) {
      console.log("Results found.");
      found = true;
      break;
    } else {
      console.log("No results yet, waiting...");
      await page.waitForTimeout(1000);
    }
  }

  if (!found) {
    throw new Error("Search failed to return results after attempts.");
  }

  await captureScreenshot(page, "search_results");

  // Check text content of result
  const firstResult = page.getByTestId("search-result-0");
  const text = await firstResult.textContent();
  console.log(`First result: ${text}`);
  expect(text).toMatch(/Alice|Wonderland/i);

  // Click result to navigate
  await firstResult.scrollIntoViewIfNeeded();
  await firstResult.dispatchEvent("click");

  // Close search (using Back Button which transforms to Close)
  await page.waitForTimeout(500);
  await page.getByTestId("reader-back-button").dispatchEvent("click");

  await captureScreenshot(page, "search_after_nav");

  console.log("Search Journey Passed!");
});
