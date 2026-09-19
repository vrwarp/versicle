import { test, expect } from './utils';
import * as utils from './utils';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Journey Advanced Import Test', async ({ page }) => {
  // 1. Open App
  await page.goto('/');
  await expect(page.getByTestId('library-view')).toBeVisible();
  await utils.captureScreenshot(page, 'advanced_import_01_library_view');

  // 2. Open Global Settings
  await page.getByTestId('header-settings-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // Verify "General" tab is active (default) and shows Advanced Import options
  await expect(page.getByRole('heading', { name: 'Advanced Import' })).toBeVisible();

  const zipBtn = page.getByRole('button', { name: 'Import ZIP Archive' });
  const folderBtn = page.getByRole('button', { name: 'Import Folder' });

  await expect(zipBtn).toBeVisible();
  await expect(folderBtn).toBeVisible();

  await utils.captureScreenshot(page, 'advanced_import_02_settings_dialog');

  // 3. Simulate ZIP Upload (Verify input is wired up and triggers dialog)
  await expect(page.locator("input[type='file'][accept='.zip']")).toBeAttached();
  await expect(page.locator("input[type='file'][webkitdirectory]")).toBeAttached();

  const fileChooserPromise = page.waitForEvent('filechooser');
  await zipBtn.click();
  const fileChooser = await fileChooserPromise;
  expect(fileChooser).toBeTruthy();

  // Close settings
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await utils.captureScreenshot(page, 'advanced_import_03_closed_settings');
});

/**
 * Importing an ILLUSTRATED book: the extractor renders it offscreen and
 * snapdom re-photographs every `<table>`, and those bytes are persisted
 * output (`cache_table_images`), shown later by the TTS table adaptation.
 *
 * The offscreen pass deliberately does NOT inflate the book's image payload
 * (epub.js otherwise blob-urls every manifest entry at open — 24.9 MB for
 * this fixture — for a pass that only wants text and CFIs). It makes one
 * exception: media a `<table>` points at. pride-and-prejudice.epub is the
 * fixture that exercises it — its title page is a `<table>` wrapping
 * `peacock-1894.png`. Without that exception the capture collapses from
 * ~4.2 KB to ~1.1 KB (a table with a broken image in it), so the floor
 * below is what keeps the artwork in the picture.
 */
test('Illustrated import keeps table artwork in the captured table images', async ({ page }) => {
  // A 25 MB fixture: extraction renders all 8 sections and snaps 2 tables.
  test.setTimeout(180000);
  await utils.resetApp(page);

  await page
    .getByTestId('hidden-file-input')
    .setInputFiles(path.resolve(__dirname, 'pride-and-prejudice.epub'));

  await expect(page.locator("[data-testid^='book-card-']").first()).toBeVisible({
    timeout: 120000,
  });
  await expect(page.getByText('Pride and Prejudice').first()).toBeVisible({ timeout: 30000 });
  await utils.waitForPersistedWrites(page);
  await utils.captureScreenshot(page, 'advanced_import_04_illustrated_imported');

  const artifacts = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('EpubLibraryDB');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const readAll = <T>(store: string) =>
      new Promise<T[]>((resolve) => {
        if (!db.objectStoreNames.contains(store)) return resolve([]);
        const req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => resolve([]);
      });

    const manifests = await readAll<{
      title: string;
      baseFontSize?: number;
      baseLineHeight?: number;
    }>('static_manifests');
    const tables = await readAll<{ cfi: string; imageBlob: ArrayBuffer | Blob }>(
      'cache_table_images',
    );
    const prep = await readAll<{ sentences: { text: string; cfi: string }[] }>(
      'cache_tts_preparation',
    );

    const sizes: number[] = [];
    for (const row of tables) {
      sizes.push(
        row.imageBlob instanceof Blob ? row.imageBlob.size : row.imageBlob.byteLength,
      );
    }
    return {
      manifest: manifests.find((m) => m.title.includes('Pride and Prejudice')) ?? null,
      tableSizes: sizes.sort((a, b) => a - b),
      sentenceCount: prep.reduce((n, row) => n + row.sentences.length, 0),
      cfisResolved: prep.every((row) => row.sentences.every((s) => s.cfi.startsWith('epubcfi('))),
    };
  });

  // Both tables in the book are captured (title page + list of illustrations).
  expect(artifacts.tableSizes).toHaveLength(2);
  // Neither collapses to a broken-image stub (measured: 4200 / 21300 bytes
  // with the artwork, 1094 without).
  expect(artifacts.tableSizes[0]).toBeGreaterThan(2000);

  // The other two extraction artifacts the same pass produces.
  expect(artifacts.manifest?.baseFontSize).toBeGreaterThan(0);
  expect(artifacts.manifest?.baseLineHeight).toBeGreaterThan(0);
  expect(artifacts.sentenceCount).toBeGreaterThan(1000);
  expect(artifacts.cfisResolved).toBe(true);
});
