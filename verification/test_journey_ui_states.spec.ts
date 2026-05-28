import { test, expect } from "./utils";
import { resetApp, ensureLibraryWithBook, captureScreenshot } from "./utils";

const tabs = [
  { tabId: "General", buttonText: "General", contentText: "Advanced Import" },
  { tabId: "TTS", buttonText: "TTS Engine", contentText: "Provider Configuration" },
  { tabId: "GenAI", buttonText: "Generative AI", contentText: "Generative AI Configuration" },
  { tabId: "Dictionary", buttonText: "Dictionary", contentText: "Pronunciation Lexicon" },
  { tabId: "Data", buttonText: "Data Management", contentText: "Backup & Restore" },
];

for (const tab of tabs) {
  test(`settings tab journey: ${tab.tabId}`, async ({ page }) => {
    console.log(`Starting Settings Tab Journey: ${tab.tabId}...`);
    await resetApp(page);
    await ensureLibraryWithBook(page);

    // Open Settings
    await expect(page.getByTestId("header-settings-button")).toBeVisible();
    await page.getByTestId("header-settings-button").click();

    // Wait for dialog
    await expect(page.getByRole("dialog")).toBeVisible();

    // Click Tab
    await page.getByRole("button", { name: tab.buttonText, exact: true }).click();

    // Verify Content (Heading)
    await expect(page.getByRole("heading", { name: tab.contentText })).toBeVisible();

    await captureScreenshot(page, `settings_tab_${tab.tabId}`);
    console.log(`Settings Tab ${tab.tabId} Passed!`);
  });
}

const dialogs = [
  { dialogName: "toc_sidebar", triggerId: "reader-toc-button" },
  { dialogName: "search_in_book", triggerId: "reader-search-button" },
];

for (const dialog of dialogs) {
  test(`dialog journey: ${dialog.dialogName}`, async ({ page }) => {
    console.log(`Starting Dialog Journey: ${dialog.dialogName}...`);
    await resetApp(page);
    await ensureLibraryWithBook(page);

    // Open book
    await page.locator("[data-testid^='book-card-']").first().click();

    // Wait for reader controls
    await expect(page.getByTestId(dialog.triggerId)).toBeVisible();
    await page.getByTestId(dialog.triggerId).click();

    if (dialog.dialogName === "toc_sidebar") {
      await expect(page.getByTestId("reader-toc-sidebar")).toBeVisible();
    } else if (dialog.dialogName === "search_in_book") {
      await expect(page.getByTestId("reader-search-sidebar")).toBeVisible();
    }

    await captureScreenshot(page, `dialog_${dialog.dialogName}`);
  });
}
