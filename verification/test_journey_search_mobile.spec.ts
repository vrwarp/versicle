import { test, expect } from "./utils";
import { resetApp, captureScreenshot } from "./utils";

test("search and sort mobile", async ({ page }) => {
  console.log("Starting Search and Sort User Journey (Mobile)...");

  // Set viewport to mobile to verify the 3-row layout and responsiveness
  await page.setViewportSize({ width: 390, height: 844 });

  await resetApp(page);

  // 1. Populate Library
  console.log("- Populating Library...");
  const loadBtn = page.getByText("Load Demo Book");
  if (await loadBtn.isVisible()) {
    await loadBtn.click();
    await expect(page.getByText("Alice's Adventures in Wonderland").first()).toBeVisible({ timeout: 10000 });
  }

  // 2. Search Functionality
  console.log("- Testing Search Functionality...");
  const searchInput = page.getByTestId("library-search-input");
  await expect(searchInput).toBeVisible();

  // 2a. Search by Title (Positive)
  console.log("  - Searching by Title: 'Alice'");
  await searchInput.fill("Alice");
  await expect(page.getByText("Alice's Adventures in Wonderland").first()).toBeVisible();
  await captureScreenshot(page, "search_result_found");

  // 2b. Search by Author (Positive)
  console.log("  - Searching by Author: 'Lewis Carroll'");
  await searchInput.fill("Lewis Carroll");
  await expect(page.getByText("Alice's Adventures in Wonderland").first()).toBeVisible();

  // 2b-bis. Test Input Clear Button (New Feature)
  console.log("  - Testing Input Clear Button");
  const inputClearBtn = page.getByLabel("Clear search");
  await expect(inputClearBtn).toBeVisible();
  await inputClearBtn.click();
  await expect(searchInput).toHaveValue("");
  await expect(inputClearBtn).not.toBeVisible();
  // Verify results reset
  await expect(page.getByText("Alice's Adventures in Wonderland").first()).toBeVisible();

  // 2c. Search (Negative)
  console.log("  - Searching for non-existent book: 'Space Odysey'");
  await searchInput.fill("Space Odysey");
  await expect(page.getByText('No books found matching "Space Odysey"')).toBeVisible();
  await captureScreenshot(page, "search_no_results");

  // 2d. Clear Search
  console.log("  - Clearing Search");
  await page.getByLabel("Clear search").click();
  await expect(page.getByText("Alice's Adventures in Wonderland").first()).toBeVisible();
  await expect(searchInput).toHaveValue("");

  // 3. Sorting Functionality
  console.log("- Testing Sorting Functionality...");

  const sortTrigger = page.getByTestId("sort-select");
  await expect(sortTrigger).toBeVisible();

  // Select 'Title'
  console.log("  - Sorting by Title");
  await sortTrigger.click();
  // Wait for the dropdown content (Title option) and click it
  await page.getByRole("option", { name: "Title" }).click();

  // Verify selection - Radix Trigger text updates to the selected value
  await expect(sortTrigger).toContainText("Title");
  await captureScreenshot(page, "search_sort_title");

  // Select 'Author'
  console.log("  - Sorting by Author");
  await sortTrigger.click();
  await page.getByRole("option", { name: "Author" }).click();
  await expect(sortTrigger).toContainText("Author");

  console.log("Search and Sort Journey Passed!");
});
