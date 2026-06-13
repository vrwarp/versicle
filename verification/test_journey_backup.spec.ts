import { test, expect } from './utils';
import * as utils from './utils';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Journey Backup & Restore (Light JSON)', async ({ page }) => {
  console.log('Starting Backup & Restore (Light JSON) Test...');
  await utils.resetApp(page);

  // 1. Import Book
  await page.waitForTimeout(1000);
  await page.setInputFiles("data-testid=hidden-file-input", path.resolve(__dirname, "alice.epub"));

  const bookCard = page.locator("[data-testid^='book-card-']").first();
  await expect(bookCard).toBeVisible({ timeout: 20000 });

  // Click to open reader
  await bookCard.click();

  // Wait for reader to load
  await expect(page.getByTestId("reader-iframe-container")).toBeVisible({ timeout: 15000 });

  // 2. Add a Lexicon rule from the reader's Settings overlay.
  // The reader gear (reader-settings-button) navigates to /settings, rendering the
  // SettingsShell overlay OVER the library; the Dictionary tab hosts "Manage Rules".
  await page.waitForTimeout(1000);

  await page.getByTestId("reader-settings-button").click({ force: true });
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 10000 });
  await page.getByRole("tab", { name: "Dictionary" }).scrollIntoViewIfNeeded().catch(() => {});
  await page.getByRole("tab", { name: "Dictionary" }).click();
  await page.getByRole("button", { name: "Manage Rules" }).click();
  await page.getByTestId("lexicon-add-rule-btn").click();

  await page.fill("data-testid=lexicon-input-original", "Rabbit");
  await page.fill("data-testid=lexicon-input-replacement", "Bunny");
  await page.click("data-testid=lexicon-save-rule-btn");

  // Close the Lexicon modal, then the Settings overlay (closing settings is a
  // history-back navigation that returns to the reader route).
  await page.getByTestId("lexicon-close-btn").click();
  await expect(page.getByTestId("lexicon-list-container")).not.toBeVisible();
  await page.getByTestId("settings-close-button").click();
  await expect(page.getByRole("tablist", { name: "Settings sections" })).not.toBeVisible();

  // Back in the reader (no sidebar open → reader-back-button navigates to library).
  await expect(page.getByTestId("reader-back-button")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("reader-back-button").click(); // Back to library
  await expect(page.getByTestId("library-view")).toBeVisible({ timeout: 25000 });

  // 3. Export Backup
  await page.waitForTimeout(500);
  await page.getByTestId("header-settings-button").click({ force: true });
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 10000 });

  if (!(await page.getByRole("button", { name: "Quick JSON Export" }).isVisible())) {
    await page.getByRole("tab", { name: "Data Management" }).scrollIntoViewIfNeeded().catch(() => {});
  await page.getByRole("tab", { name: "Data Management" }).click({ force: true });
  }

  // Setup download listener
  const downloadPromise = page.waitForEvent('download');
  await page.click("button:has-text('Quick JSON Export')");
  const download = await downloadPromise;

  let suggestedFilename = download.suggestedFilename();
  if (!suggestedFilename.endsWith('.json')) {
    suggestedFilename += '.json';
  }

  const uniqueId = Math.random().toString(36).substring(2, 10);
  const backupPath = `/tmp/backup_${uniqueId}_${suggestedFilename}`;
  await download.saveAs(backupPath);
  console.log(`Backup saved to: ${backupPath}`);

  // Close Settings (await the overlay/backdrop to detach so it can't intercept
  // the book context-menu click below).
  await page.getByTestId("settings-close-button").click();
  await expect(page.getByRole("tablist", { name: "Settings sections" })).not.toBeVisible({ timeout: 10000 });

  // 4. Delete Book
  await bookCard.hover();
  await page.locator("data-testid=book-context-menu-trigger").click({ force: true });
  await page.click("data-testid=menu-delete");

  // Confirm in custom dialog
  await page.click("data-testid=confirm-delete");
  await expect(bookCard).not.toBeVisible({ timeout: 5000 });

  // 5. Restore Backup
  await page.waitForTimeout(500);
  await page.getByTestId("header-settings-button").click({ force: true });
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 10000 });

  if (!(await page.getByRole("button", { name: "Quick JSON Export" }).isVisible())) {
    await page.getByRole("tab", { name: "Data Management" }).scrollIntoViewIfNeeded().catch(() => {});
  await page.getByRole("tab", { name: "Data Management" }).click({ force: true });
  }

  // The Data panel is lazy-loaded (settings registry import()); under load its
  // hidden restore input mounts a beat after the tab activates. Wait for it.
  await page.locator("[data-testid=\"backup-file-input\"]").waitFor({ state: "attached", timeout: 15000 });
  await page.setInputFiles("data-testid=backup-file-input", backupPath);

  // The restore now uses an in-app ConfirmDialog (the old window.confirm() is gone);
  // confirm the "merge data" prompt before the restore proceeds.
  await utils.acceptConfirm(page);

  // Wait for reload
  await expect(page.getByTestId("library-view")).toBeVisible({ timeout: 25000 });

  // 6. Verify Restore
  await expect(bookCard).toBeVisible({ timeout: 15000 });

  // Since it was a light backup, the book should be "Offloaded" (cloud icon)
  await expect(page.locator(".bg-black\\/20")).toBeVisible({ timeout: 10000 });

  await utils.captureScreenshot(page, "backup_restore_complete");

  // Cleanup
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
  }
});

test('Journey Full Backup & Restore (ZIP)', async ({ page }) => {
  console.log('Starting Full Backup & Restore (ZIP) Test...');
  await utils.resetApp(page);

  // 1. Import Book
  await page.waitForTimeout(1000);
  await page.setInputFiles("data-testid=hidden-file-input", path.resolve(__dirname, "alice.epub"));

  const bookCard = page.locator("[data-testid^='book-card-']").first();
  await expect(bookCard).toBeVisible({ timeout: 20000 });

  // 2. Export Full Backup
  await page.waitForTimeout(500);
  await page.getByTestId("header-settings-button").click({ force: true });
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 10000 });

  if (!(await page.getByRole("button", { name: "Full ZIP Export" }).isVisible())) {
    // On mobile the tablist is a horizontal scroll strip; bring the tab into view first.
    const dataTab = page.getByRole("tab", { name: "Data Management" });
    await dataTab.scrollIntoViewIfNeeded().catch(() => {});
    await dataTab.click({ force: true });
  }

  const downloadPromise = page.waitForEvent('download');
  await page.click("button:has-text('Full ZIP Export')");
  const download = await downloadPromise;

  let suggestedFilename = download.suggestedFilename();
  if (!suggestedFilename.endsWith('.zip')) {
    suggestedFilename += '.zip';
  }

  const uniqueId = Math.random().toString(36).substring(2, 10);
  const backupPath = `/tmp/backup_${uniqueId}_${suggestedFilename}`;
  await download.saveAs(backupPath);
  console.log(`Full Backup saved to: ${backupPath}`);

  // Close Settings (await the overlay/backdrop to detach before the context-menu click).
  await page.getByTestId("settings-close-button").click();
  await expect(page.getByRole("tablist", { name: "Settings sections" })).not.toBeVisible({ timeout: 10000 });

  // 3. Delete Book
  await bookCard.hover();
  await page.locator("data-testid=book-context-menu-trigger").click({ force: true });
  await page.click("data-testid=menu-delete");
  await page.click("data-testid=confirm-delete");
  await expect(bookCard).not.toBeVisible({ timeout: 5000 });

  // 4. Restore Backup
  await page.waitForTimeout(500);
  await page.getByTestId("header-settings-button").click({ force: true });
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 10000 });

  if (!(await page.getByRole("button", { name: "Full ZIP Export" }).isVisible())) {
    const dataTab = page.getByRole("tab", { name: "Data Management" });
    await dataTab.scrollIntoViewIfNeeded().catch(() => {});
    await dataTab.click({ force: true });
  }

  // The Data panel is lazy-loaded (settings registry import()); under load its
  // hidden restore input mounts a beat after the tab activates. Wait for it.
  await page.locator("[data-testid=\"backup-file-input\"]").waitFor({ state: "attached", timeout: 15000 });
  await page.setInputFiles("data-testid=backup-file-input", backupPath);

  // Restore uses an in-app ConfirmDialog now (native window.confirm() removed).
  await utils.acceptConfirm(page);

  // Wait for reload
  await expect(page.getByTestId("library-view")).toBeVisible({ timeout: 25000 });

  // 5. Verify Restore
  await expect(bookCard).toBeVisible({ timeout: 20000 });

  // Should NOT be offloaded (no cloud icon overlay)
  await expect(page.locator(".bg-black\\/20")).not.toBeVisible({ timeout: 10000 });

  await utils.captureScreenshot(page, "full_backup_restore_complete");

  // Cleanup
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
  }
});
