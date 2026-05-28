import { test, expect } from "./utils";
import { captureScreenshot, resetApp, ensureLibraryWithBook } from "./utils";

test("sidebar height layout", async ({ page }) => {
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open Reader
  await page.locator('[data-testid^="book-card-"]').first().click();
  await expect(page.getByTestId("reader-view")).toBeVisible();

  // Open TOC
  await page.getByTestId("reader-toc-button").click();
  await expect(page.getByTestId("reader-toc-sidebar")).toBeVisible();

  // Inspect children of Tabs Root and verify height
  await page.evaluate(() => {
    const sidebar = document.querySelector('[data-testid="reader-toc-sidebar"]');
    if (!sidebar) throw new Error("Sidebar not found");

    const tabsRoot = sidebar.firstElementChild;
    if (!tabsRoot) throw new Error("Tabs root not found");

    console.log("Tabs Root Children:");
    Array.from(tabsRoot.children).forEach((child, index) => {
      const style = window.getComputedStyle(child);
      console.log(`Child ${index}: Tag=${child.tagName}, Display=${style.display}, Height=${child.getBoundingClientRect().height}, FlexGrow=${style.flexGrow}`);
      if (child.getAttribute('role') === 'tabpanel') {
        console.log(`  Role=tabpanel, State=${child.getAttribute('data-state')}, ID=${child.id}`);
      }
    });

    const content = document.querySelector('[data-state="active"][role="tabpanel"]');
    if (!content) throw new Error("Active tabpanel not found");

    if (Math.abs(sidebar.getBoundingClientRect().bottom - content.getBoundingClientRect().bottom) > 5) {
      throw new Error(`Content does not extend to bottom.`);
    }
  });

  await captureScreenshot(page, "sidebar_layout");
});
