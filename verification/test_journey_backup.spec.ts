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
  await expect(bookCard).toBeVisible({ timeout: 5000 });

  // Click to open reader
  await bookCard.click();

  // Wait for reader to load
  await expect(page.getByTestId("reader-iframe-container")).toBeVisible({ timeout: 5000 });

  // 2. Add Annotation via Lexicon rule
  await page.waitForTimeout(1000);

  await page.click("button[aria-label='Settings']", { force: true });
  await page.getByRole("button", { name: "Dictionary" }).click();
  await page.getByRole("button", { name: "Manage Rules" }).click();
  await page.getByTestId("lexicon-add-rule-btn").click();

  await page.fill("data-testid=lexicon-input-original", "Rabbit");
  await page.fill("data-testid=lexicon-input-replacement", "Bunny");
  await page.click("data-testid=lexicon-save-rule-btn");

  // Close Lexicon and Settings
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.click("data-testid=reader-back-button"); // Back to library

  // 3. Export Backup
  await page.waitForTimeout(500);
  await page.click("button[aria-label='Settings']", { force: true });
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10000 });

  if (!(await page.getByRole("button", { name: "Quick JSON Export" }).isVisible())) {
    await page.getByRole("button", { name: "Data Management" }).click({ force: true });
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

  // Close Settings
  await page.keyboard.press("Escape");

  // 4. Delete Book
  await bookCard.hover();
  await page.locator("data-testid=book-context-menu-trigger").click({ force: true });
  await page.click("data-testid=menu-delete");

  // Confirm in custom dialog
  await page.click("data-testid=confirm-delete");
  await expect(bookCard).not.toBeVisible({ timeout: 5000 });

  // 5. Restore Backup
  await page.waitForTimeout(500);
  await page.click("button[aria-label='Settings']", { force: true });
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10000 });

  if (!(await page.getByRole("button", { name: "Quick JSON Export" }).isVisible())) {
    await page.getByRole("button", { name: "Data Management" }).click({ force: true });
  }

  // Handle the merge confirmation dialog
  page.once("dialog", (dialog) => dialog.accept());

  await page.setInputFiles("data-testid=backup-file-input", backupPath);

  // Wait for reload
  await expect(page.getByTestId("library-view")).toBeVisible({ timeout: 5000 });

  // 6. Verify Restore
  await expect(bookCard).toBeVisible({ timeout: 5000 });

  // Since it was a light backup, the book should be "Offloaded" (cloud icon)
  await expect(page.locator(".bg-black\\/20")).toBeVisible({ timeout: 5000 });

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
  await expect(bookCard).toBeVisible({ timeout: 5000 });

  // 2. Export Full Backup
  await page.waitForTimeout(500);
  await page.click("button[aria-label='Settings']", { force: true });
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10000 });

  if (!(await page.getByRole("button", { name: "Full ZIP Export" }).isVisible())) {
    await page.getByRole("button", { name: "Data Management" }).click({ force: true });
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

  // Close Settings
  await page.keyboard.press("Escape");

  // 3. Delete Book
  await bookCard.hover();
  await page.locator("data-testid=book-context-menu-trigger").click({ force: true });
  await page.click("data-testid=menu-delete");
  await page.click("data-testid=confirm-delete");
  await expect(bookCard).not.toBeVisible({ timeout: 5000 });

  // 4. Restore Backup
  await page.waitForTimeout(500);
  await page.click("button[aria-label='Settings']", { force: true });
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10000 });

  if (!(await page.getByRole("button", { name: "Full ZIP Export" }).isVisible())) {
    await page.getByRole("button", { name: "Data Management" }).click({ force: true });
  }

  page.once("dialog", (dialog) => dialog.accept());
  await page.setInputFiles("data-testid=backup-file-input", backupPath);

  // Wait for reload
  await expect(page.getByTestId("library-view")).toBeVisible({ timeout: 5000 });

  // 5. Verify Restore
  await expect(bookCard).toBeVisible({ timeout: 5000 });

  // Should NOT be offloaded (no cloud icon overlay)
  await expect(page.locator(".bg-black\\/20")).not.toBeVisible({ timeout: 5000 });

  await utils.captureScreenshot(page, "full_backup_restore_complete");

  // Cleanup
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
  }
});
