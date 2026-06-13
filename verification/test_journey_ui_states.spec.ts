import { test, expect } from "./utils";
import { resetApp, ensureLibraryWithBook, captureScreenshot, openSettings, gotoSettingsTab } from "./utils";

// Settings became a Radix-Tabs SettingsShell at /settings/:tab. Each tab is a real
// role="tab" inside the "Settings sections" tablist (testid settings-tab-<id>), no
// longer a role=button sidebar entry. The content panel heading per tab is unchanged.
const tabs = [
  { tabId: "General", tabKey: "general", contentText: "Advanced Import" },
  { tabId: "TTS", tabKey: "tts", contentText: "Provider Configuration" },
  { tabId: "GenAI", tabKey: "genai", contentText: "Generative AI Configuration" },
  { tabId: "Dictionary", tabKey: "dictionary", contentText: "Pronunciation Lexicon" },
  { tabId: "Data", tabKey: "data", contentText: "Backup & Restore" },
];

for (const tab of tabs) {
  test(`settings tab journey: ${tab.tabId}`, async ({ page }) => {
    console.log(`Starting Settings Tab Journey: ${tab.tabId}...`);
    await resetApp(page);
    await ensureLibraryWithBook(page);

    // Open Settings (Radix tablist) and activate the target tab.
    await openSettings(page);
    await gotoSettingsTab(page, tab.tabKey);

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
