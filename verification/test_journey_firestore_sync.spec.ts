import type { Page } from '@playwright/test';
import { test, expect, openSettings, gotoSettingsTab, closeSettings } from './utils';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function uploadBook(page: Page, filename: string) {
  console.log(`Uploading ${filename}...`);
  const filePath = path.resolve(__dirname, filename);
  const fileBuffer = fs.readFileSync(filePath);
  const fileBase64 = fileBuffer.toString('base64');

  await page.evaluate(({ base64Data, filename }) => {
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const file = new File([byteArray], filename, { type: 'application/epub+zip' });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const dropEvent = new DragEvent('drop', { dataTransfer: dataTransfer, bubbles: true });
    document.querySelector('[data-testid="library-view"]')!.dispatchEvent(dropEvent);
  }, { base64Data: fileBase64, filename });
}

test('Firestore Book Sync and Restore', async ({ browser }) => {
  test.setTimeout(180_000);
  console.log('========== DEVICE A: Import Book & Sync ==========');
  
  const contextA = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  const pageA = await contextA.newPage();

  pageA.on('console', (msg) => console.log(`[A] ${msg.text()}`));
  pageA.on('pageerror', (err) => console.error(`[A ERROR] ${err}`));

  // Inject polyfill content
  const ttsPolyfillPath = path.resolve(__dirname, 'tts-polyfill.js');
  const ttsPolyfillContent = fs.readFileSync(ttsPolyfillPath, 'utf8');

  await pageA.addInitScript({ content: 'window.__VERSICLE_MOCK_FIRESTORE__ = true;' });
  await pageA.addInitScript({ content: 'window.__VERSICLE_SANITIZATION_DISABLED__ = true;' });
  await pageA.addInitScript({ content: 'window.__VERSICLE_FIRESTORE_DEBOUNCE_MS__ = 20;' });
  await pageA.addInitScript({ content: ttsPolyfillContent });

  // Clear data
  await pageA.goto('/');
  await pageA.evaluate(async () => {
    if (typeof (window as any /* eslint-disable-line @typescript-eslint/no-explicit-any */).__DISCONNECT_YJS__ === 'function') {
      await (window as any /* eslint-disable-line @typescript-eslint/no-explicit-any */).__DISCONNECT_YJS__();
    }
    if (typeof (window as any /* eslint-disable-line @typescript-eslint/no-explicit-any */).__CLOSE_DB__ === 'function') {
      await (window as any /* eslint-disable-line @typescript-eslint/no-explicit-any */).__CLOSE_DB__();
    }
    const dbs = await window.indexedDB.databases();
    for (const db of dbs) {
      if (db.name) {
        await new Promise<void>((resolve) => {
          const req = window.indexedDB.deleteDatabase(db.name!);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        });
      }
    }
    localStorage.clear();
  });
  await pageA.reload();

  await expect(pageA.getByTestId('library-view')).toBeVisible({ timeout: 15000 });

  const booksToUpload = [
    'alice.epub',
    'jane-eyre.epub',
    'room-with-a-view.epub',
    'frankenstein.epub',
    'pride-and-prejudice.epub'
  ];

  for (const filename of booksToUpload) {
    await uploadBook(pageA, filename);
    await pageA.waitForTimeout(1000);
  }

  await expect(pageA.locator("[data-testid^='book-card-']")).toHaveCount(booksToUpload.length, { timeout: 80000 });
  await pageA.waitForTimeout(1000);
  const bookTitlesA = await pageA.locator("[data-testid='book-title']").allTextContents();
  console.log(`[A] Book titles: ${bookTitlesA}`);

  await pageA.waitForTimeout(2000);
  await pageA.evaluate(() => {
    window.dispatchEvent(new Event('beforeunload'));
  });
  await pageA.waitForTimeout(1000);

  const mockDataStr = await pageA.evaluate(() => localStorage.getItem('versicle_mock_firestore_snapshot'));
  expect(mockDataStr).toBeTruthy();

  const mockData = JSON.parse(mockDataStr!);
  const syncPath = Object.keys(mockData).find((k) => k.startsWith('users/mock-user/versicle/ws_'));
  expect(syncPath).toBeTruthy();

  const snapshotB64 = mockData[syncPath!].snapshotBase64;
  expect(snapshotB64).toBeTruthy();

  await pageA.close();
  await contextA.close();

  console.log('========== DEVICE B: Load Synced Data ==========');
  
  const contextB = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  const pageB = await contextB.newPage();

  pageB.on('console', (msg) => console.log(`[B] ${msg.text()}`));
  pageB.on('pageerror', (err) => console.error(`[B ERROR] ${err}`));

  let injectionCode = `
    window.__VERSICLE_MOCK_FIRESTORE__ = true;
    window.__VERSICLE_MOCK_USER_ID__ = 'mock-user';
    window.__VERSICLE_SANITIZATION_DISABLED__ = true;
    window.__VERSICLE_FIRESTORE_DEBOUNCE_MS__ = 20;
    localStorage.setItem('versicle_mock_firestore_snapshot', ${JSON.stringify(mockDataStr)});
  `;

  const snapshotDict = JSON.parse(mockDataStr!);
  const pathKey = Object.keys(snapshotDict).find((k) => k.includes('/versicle/ws_'));
  if (pathKey) {
    const workspaceId = pathKey.split('/').pop();
    injectionCode += `
      localStorage.setItem('__VERSICLE_WORKSPACES__', JSON.stringify([{
        workspaceId: '${workspaceId}',
        name: 'My Library',
        createdAt: Date.now(),
        schemaVersion: 5
      }]));
    `;
  }

  await pageB.addInitScript({ content: injectionCode });
  await pageB.addInitScript({ content: ttsPolyfillContent });

  await pageB.goto('/');
  await expect(pageB.getByTestId('library-view')).toBeVisible({ timeout: 15000 });

  // Settings is now a Radix-Tabs SettingsShell at /settings/:tab (Phase-10 overhaul);
  // the old role=button "Sync & Cloud" tab is now a real Radix tab.
  await openSettings(pageB);
  await gotoSettingsTab(pageB, 'sync');

  await expect(pageB.getByTestId('sync-halt-warning')).toBeVisible({ timeout: 20000 });
  await pageB.getByRole('button', { name: 'Switch' }).click();

  await expect(pageB.getByText('Finalize Workspace Switch?')).toBeVisible({ timeout: 15000 });

  // The staged-swap reloads land back on /settings/sync, so the Radix
  // SettingsShell dialog re-opens UNDER the app-level confirmation modal and
  // makes that sibling modal inert — its overlay intercepts the "Yes, Finalize"
  // click. Escape closes the settings dialog (its Escape handler fires beneath
  // the plain confirmation overlay) and navigates back to the library, so the
  // confirmation button becomes interactable and no settings backdrop lingers.
  await pageB.keyboard.press('Escape');
  await expect(pageB.getByRole('tablist', { name: 'Settings sections' })).not.toBeVisible({ timeout: 10000 });
  await pageB.getByRole('button', { name: 'Yes, Finalize' }).dispatchEvent("click");

  await expect(pageB.getByTestId('library-view')).toBeVisible({ timeout: 30000 });
  await pageB.waitForTimeout(2000); // Wait for page to fully stabilize after potential internal navigation

  const injected = await pageB.evaluate(() => localStorage.getItem('versicle_mock_firestore_snapshot'));
  expect(injected).toBeTruthy();

  for (let i = 0; i < 30; i++) {
    try {
      const bookCards = await pageB.locator("[data-testid^='book-card-']").count();
      if (bookCards > 0) break;
    } catch {
      // Context might be temporarily unstable during navigation
    }
    await pageB.waitForTimeout(500);
  }

  const cardIds = await pageB.locator("[data-testid^='book-card-']").evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  console.log(`[B] Found ${cardIds.length} cards: ${cardIds}`);
  expect(cardIds.length).toBeGreaterThanOrEqual(5);

  await pageB.waitForTimeout(1000);
  const syncedTitles = await pageB.locator("[data-testid='book-title']").allTextContents();
  console.log(`[B] Synced titles: ${syncedTitles}`);
  expect(syncedTitles.sort()).toEqual(bookTitlesA.sort());

  console.log('Refreshing page to verify persistence...');
  await pageB.reload();
  await expect(pageB.getByTestId('library-view')).toBeVisible({ timeout: 15000 });

  const countAfterRefresh = await pageB.locator("[data-testid^='book-card-']").count();
  expect(countAfterRefresh).toBeGreaterThanOrEqual(5);

  const refreshedTitles = await pageB.locator("[data-testid='book-title']").allTextContents();
  expect(refreshedTitles.sort()).toEqual(bookTitlesA.sort());

  const bookCardAlice = pageB.locator("[data-testid^='book-card-']").filter({ hasText: "Alice's Adventures in Wonderland" }).first();
  await expect(bookCardAlice).toBeVisible();

  const offloadIndicator = bookCardAlice.locator('.bg-black\\/20');
  await expect(offloadIndicator).toBeVisible({ timeout: 5000 });

  console.log('========== DEVICE B: Restore Book File ==========');
  await bookCardAlice.dispatchEvent("click");
  await pageB.waitForTimeout(1000);

  const restoreFilePath = path.resolve(__dirname, 'alice.epub');
  // The ContentMissingDialog mounts the hidden restore input lazily; wait for it to
  // attach before supplying the file (deterministic wait, not a fixed sleep).
  await pageB.locator("[data-testid='restore-file-input']").waitFor({ state: 'attached', timeout: 15000 });
  await pageB.setInputFiles('data-testid=restore-file-input', restoreFilePath);
  await pageB.waitForTimeout(3000);

  // The offload overlay clears once the re-supplied epub finishes re-ingesting (slow on
  // WebKit under full-suite load).
  await expect(offloadIndicator).not.toBeVisible({ timeout: 45000 });

  // The ContentMissingDialog is a Radix Dialog; its bg-black/50 backdrop lingers for an
  // animation frame after the dialog closes on successful restore and intercepts the
  // next card click (the §0 backdrop-interception signature). Wait for that SPECIFIC
  // dialog (and its hidden restore input) to detach before re-clicking the card to open
  // the reader. A global `div.bg-black/50.backdrop-blur-sm` count is too broad — the same
  // class is the overlay of EVERY Radix Modal/Dialog (the SettingsShell, ConfirmDialog,
  // etc.), so it false-positives on any other open dialog. These are deterministic waits
  // on the elements, not fixed sleeps.
  await pageB.locator("[data-testid='restore-file-input']").waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await expect(pageB.getByRole('dialog', { name: 'Content Missing' })).toHaveCount(0, { timeout: 15000 });
  // The earlier staged workspace-switch reloads land back on /settings/sync, so the
  // SettingsShell route-modal can still be open over the library; its open bg-black/50
  // overlay intercepts the card click. Land on a clean library route with no open Radix
  // dialog overlay before re-opening the reader.
  await pageB.keyboard.press('Escape').catch(() => {});
  if (pageB.url().includes('/settings')) {
    await pageB.goto('/');
    await expect(pageB.getByTestId('library-view')).toBeVisible({ timeout: 15000 });
  }
  await expect(pageB.locator("div[data-state='open'].bg-black\\/50")).toHaveCount(0, { timeout: 10000 });
  await bookCardAlice.dispatchEvent("click");
  await expect(pageB.getByTestId('reader-iframe-container')).toBeVisible({ timeout: 10000 });

  await pageB.close();
  await contextB.close();
});

test('Offload Status Hydration', async ({ browser }) => {
  const contextA = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  const pageA = await contextA.newPage();

  const ttsPolyfillPath = path.resolve(__dirname, 'tts-polyfill.js');
  const ttsPolyfillContent = fs.readFileSync(ttsPolyfillPath, 'utf8');

  await pageA.addInitScript({ content: 'window.__VERSICLE_MOCK_FIRESTORE__ = true;' });
  await pageA.addInitScript({ content: 'window.__VERSICLE_SANITIZATION_DISABLED__ = true;' });
  await pageA.addInitScript({ content: ttsPolyfillContent });

  await pageA.goto('/');
  await pageA.evaluate(async () => {
    if (typeof (window as any /* eslint-disable-line @typescript-eslint/no-explicit-any */).__DISCONNECT_YJS__ === 'function') {
      await (window as any /* eslint-disable-line @typescript-eslint/no-explicit-any */).__DISCONNECT_YJS__();
    }
    if (typeof (window as any /* eslint-disable-line @typescript-eslint/no-explicit-any */).__CLOSE_DB__ === 'function') {
      await (window as any /* eslint-disable-line @typescript-eslint/no-explicit-any */).__CLOSE_DB__();
    }
    const dbs = await window.indexedDB.databases();
    for (const db of dbs) {
      if (db.name) {
        await new Promise<void>((resolve) => {
          const req = window.indexedDB.deleteDatabase(db.name!);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        });
      }
    }
    localStorage.clear();
  });
  await pageA.reload();

  await expect(pageA.getByTestId('library-view')).toBeVisible({ timeout: 15000 });

  await uploadBook(pageA, 'alice.epub');
  const bookCardA = pageA.locator("[data-testid^='book-card-']").first();
  await expect(bookCardA).toBeVisible({ timeout: 15000 });

  await pageA.waitForTimeout(2000);
  await pageA.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
  await pageA.waitForTimeout(1000);

  const mockDataStr = await pageA.evaluate(() => localStorage.getItem('versicle_mock_firestore_snapshot'));
  expect(mockDataStr).toBeTruthy();

  await pageA.close();
  await contextA.close();

  const contextB = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  const pageB = await contextB.newPage();

  await pageB.addInitScript({ content: 'window.__VERSICLE_MOCK_FIRESTORE__ = true;' });
  await pageB.addInitScript({ content: 'window.__VERSICLE_SANITIZATION_DISABLED__ = true;' });
  await pageB.addInitScript({ content: `localStorage.setItem('versicle_mock_firestore_snapshot', ${JSON.stringify(mockDataStr)});` });

  const snapshotDict = JSON.parse(mockDataStr!);
  const pathKey = Object.keys(snapshotDict).find((k) => k.includes('/versicle/ws_'));
  if (pathKey) {
    const workspaceId = pathKey.split('/').pop();
    await pageB.addInitScript({ content: `
      localStorage.setItem('__VERSICLE_WORKSPACES__', JSON.stringify([{
        workspaceId: '${workspaceId}',
        name: 'My Library',
        createdAt: Date.now(),
        schemaVersion: 5
      }]));
    `});
  }
  await pageB.addInitScript({ content: ttsPolyfillContent });

  await pageB.goto('/');
  await expect(pageB.getByTestId('library-view')).toBeVisible({ timeout: 15000 });

  // SettingsShell Radix tabs (Phase-10): Sync & Cloud is now a real Radix tab.
  await openSettings(pageB);
  await gotoSettingsTab(pageB, 'sync');

  await expect(pageB.getByTestId('sync-halt-warning')).toBeVisible({ timeout: 20000 });
  await pageB.getByRole('button', { name: 'Switch' }).click();

  await expect(pageB.getByText('Finalize Workspace Switch?')).toBeVisible({ timeout: 15000 });

  // The staged-swap reloads land back on /settings/sync, so the Radix
  // SettingsShell dialog re-opens UNDER the app-level confirmation modal and
  // makes that sibling modal inert — its overlay intercepts the "Yes, Finalize"
  // click. Escape closes the settings dialog (its Escape handler fires beneath
  // the plain confirmation overlay) so the confirmation button is interactable.
  await pageB.keyboard.press('Escape');
  await expect(pageB.getByRole('tablist', { name: 'Settings sections' })).not.toBeVisible({ timeout: 10000 });
  await pageB.getByRole('button', { name: 'Yes, Finalize' }).dispatchEvent("click");

  await expect(pageB.getByTestId('library-view')).toBeVisible({ timeout: 30000 });

  for (let i = 0; i < 20; i++) {
    if (await pageB.locator("[data-testid^='book-card-']").count() > 0) break;
    await pageB.waitForTimeout(500);
  }

  const bookCardB = pageB.locator("[data-testid^='book-card-']").first();
  await expect(bookCardB).toBeVisible({ timeout: 10000 });

  const offloadIndicator = pageB.locator('.bg-black\\/20');
  await expect(offloadIndicator).toBeVisible({ timeout: 5000 });

  await pageB.close();
  await contextB.close();
});

test('Offline Resilience Test', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  const ttsPolyfillPath = path.resolve(__dirname, 'tts-polyfill.js');
  const ttsPolyfillContent = fs.readFileSync(ttsPolyfillPath, 'utf8');

  await page.addInitScript({ content: `
    window.__VERSICLE_MOCK_FIRESTORE__ = true;
    window.__VERSICLE_SANITIZATION_DISABLED__ = true;
  `});
  await page.addInitScript({ content: ttsPolyfillContent });

  await page.goto('/');
  await expect(page.getByTestId('library-view')).toBeVisible({ timeout: 15000 });

  // SettingsShell Radix tabs (Phase-10): open the Dictionary tab, then Manage Rules.
  await openSettings(page);
  await gotoSettingsTab(page, 'dictionary');
  await page.getByRole('button', { name: 'Manage Rules' }).click();
  await page.getByTestId('lexicon-add-rule-btn').click();
  await page.getByTestId('lexicon-input-original').fill('OfflineTest');
  await page.getByTestId('lexicon-input-replacement').fill('OfflineReplacement');
  await page.getByTestId('lexicon-save-rule-btn').click();

  await expect(page.getByText('OfflineTest')).toBeVisible();

  await page.getByTestId('lexicon-close-btn').click();
  // Close the Settings overlay and wait for the URL to leave /settings —
  // reloading while still on /settings/dictionary re-opens the route-driven
  // dialog, whose backdrop then blocks the openSettings click below.
  await closeSettings(page);

  await page.reload();

  await expect(page.getByTestId('library-view')).toBeVisible({ timeout: 10000 });

  // Re-open the Dictionary tab after reload to verify the rule persisted.
  await openSettings(page);
  await gotoSettingsTab(page, 'dictionary');
  await page.getByRole('button', { name: 'Manage Rules' }).click();

  await expect(page.getByText('OfflineTest')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('OfflineReplacement')).toBeVisible();

  await page.close();
  await context.close();
});
