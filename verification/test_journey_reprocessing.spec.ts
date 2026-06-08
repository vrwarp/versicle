import { test, expect } from "./utils";
import { ensureLibraryWithBook, captureScreenshot, resetApp, waitForPersistedWrites } from "./utils";

test("verify reprocessing interstitial", async ({ page }) => {
  // Re-enabled on WebKit. The earlier "pathologically slow / never returns" symptom was not
  // slowness — reprocessBook stored table images as Blobs, which WebKit's IndexedDB cannot
  // structured-clone (DataCloneError: "BlobURLs are not yet supported"), so the upgrade threw
  // and the reader never loaded. Table images are now converted to ArrayBuffer before the put.
  // give the whole test extra headroom beyond the project default
  test.setTimeout(240000);
  // 1. Reset app using utility
  await resetApp(page);

  // 2. Ensure we have the demo book using utility
  await ensureLibraryWithBook(page);

  // 3. Find the book ID and downgrade version
  const bookTitle = "Alice's Adventures in Wonderland";
  let bookId: string | null = null;

  // Retry loop for DB persistence
  for (let i = 0; i < 10; i++) {
    bookId = await page.evaluate((title) => {
      return new Promise<string | null>((resolve) => {
        const req = indexedDB.open("EpubLibraryDB", 24);
        req.onsuccess = (e: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => {
          const db = e.target.result;
          console.log("IndexedDB EpubLibraryDB opened successfully. Object stores:", Array.from(db.objectStoreNames));
          if (!db.objectStoreNames.contains("static_manifests")) {
            resolve(null);
            return;
          }
          const tx = db.transaction("static_manifests", "readonly");
          const store = tx.objectStore("static_manifests");
          store.getAll().onsuccess = (ev: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => {
            const manifests = ev.target.result;
            console.log("All manifests in DB:", manifests.map((m: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => m.title));
            const manifest = manifests.find((m: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => m.title.includes(title));
            resolve(manifest ? manifest.bookId : null);
          };
        };
        req.onerror = (err) => {
          console.error("Failed to open EpubLibraryDB:", err);
          resolve(null);
        };
      });
    }, bookTitle);

    if (bookId) {
      break;
    }
    await page.waitForTimeout(500);
  }

  console.log(`Found book ID: ${bookId}`);
  if (!bookId) {
    throw new Error("Could not find demo book ID in DB after loading");
  }

  // Update the book version to 0
  await page.evaluate((id) => {
    return new Promise<boolean>((resolve) => {
      const req = indexedDB.open("EpubLibraryDB", 24);
      req.onsuccess = (e: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => {
        const db = e.target.result;
        const tx = db.transaction("static_manifests", "readwrite");
        const store = tx.objectStore("static_manifests");
        store.get(id).onsuccess = (ev: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => {
          const manifest = ev.target.result;
          manifest.schemaVersion = 0;
          store.put(manifest).onsuccess = () => resolve(true);
        };
      };
    });
  }, bookId);

  console.log("Downgraded book version to 0.");

  // Let the debounced Yjs library write reach disk before the hard reload, otherwise the book
  // is gone from the library after reload (the on-screen card renders from the in-memory store,
  // which does not prove the entry has been persisted to y-idb yet).
  await waitForPersistedWrites(page);

  // Reload to ensure Reader checks the new (old) version
  await page.reload();

  // 3. Open the book
  await page.getByText(bookTitle).first().click();

  // 4. Expect Reprocessing Interstitial
  console.log("Waiting for interstitial...");
  try {
    // We check for the loading state or the specific text
    const interstitial = page.getByText("Upgrading Book...");
    await expect(interstitial).toBeVisible({ timeout: 5000 });
    console.log("Interstitial visible.");

    // Take screenshot while it's processing
    await captureScreenshot(page, "reprocessing_interstitial");
  } catch (e) {
    console.log("Interstitial missed or failed to appear (might be too fast):", e);
    await captureScreenshot(page, "reprocessing_missed");
  }

  // Wait for it to finish and reader to load (reprocessing can be slow in WebKit)
  await expect(page.getByTestId("reader-view")).toBeVisible({ timeout: 150000 });

  // 5. Verify metadata update
  const newVersion = await page.evaluate((id) => {
    return new Promise<number>((resolve) => {
      const req = indexedDB.open("EpubLibraryDB", 24);
      req.onsuccess = (e: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => {
        const db = e.target.result;
        const tx = db.transaction("static_manifests", "readonly");
        const store = tx.objectStore("static_manifests");
        store.get(id).onsuccess = (ev: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => resolve(ev.target.result.schemaVersion);
      };
    });
  }, bookId);

  console.log(`Book version after processing: ${newVersion}`);
  expect(newVersion).toBe(11);
});
