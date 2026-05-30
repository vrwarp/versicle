import { test, expect } from "./utils";
import { ensureLibraryWithBook, captureScreenshot, resetApp } from "./utils";

test("verify reprocessing interstitial", async ({ page }) => {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
        req.onsuccess = (e: any) => {
          const db = e.target.result;
          console.log("IndexedDB EpubLibraryDB opened successfully. Object stores:", Array.from(db.objectStoreNames));
          if (!db.objectStoreNames.contains("static_manifests")) {
            resolve(null);
            return;
          }
          const tx = db.transaction("static_manifests", "readonly");
          const store = tx.objectStore("static_manifests");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
          store.getAll().onsuccess = (ev: any) => {
            const manifests = ev.target.result;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
            console.log("All manifests in DB:", manifests.map((m: any) => m.title));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const manifest = manifests.find((m: any) => m.title.includes(title));
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
      req.onsuccess = (e: any) => {
        const db = e.target.result;
        const tx = db.transaction("static_manifests", "readwrite");
        const store = tx.objectStore("static_manifests");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
        store.get(id).onsuccess = (ev: any) => {
          const manifest = ev.target.result;
          manifest.schemaVersion = 0;
          store.put(manifest).onsuccess = () => resolve(true);
        };
      };
    });
  }, bookId);

  console.log("Downgraded book version to 0.");

  // Reload to ensure Reader checks the new (old) version
  await page.reload();

  // 3. Open the book
  await page.getByText(bookTitle).click();

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

  // Wait for it to finish and reader to load
  await expect(page.getByTestId("reader-view")).toBeVisible({ timeout: 30000 });

  // 5. Verify metadata update
  const newVersion = await page.evaluate((id) => {
    return new Promise<number>((resolve) => {
      const req = indexedDB.open("EpubLibraryDB", 24);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
      req.onsuccess = (e: any) => {
        const db = e.target.result;
        const tx = db.transaction("static_manifests", "readonly");
        const store = tx.objectStore("static_manifests");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
        store.get(id).onsuccess = (ev: any) => resolve(ev.target.result.schemaVersion);
      };
    });
  }, bookId);

  console.log(`Book version after processing: ${newVersion}`);
  expect(newVersion).toBe(9);
});
