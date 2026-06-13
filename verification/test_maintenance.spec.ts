import { test, expect } from "./utils";
import { resetApp, ensureLibraryWithBook, openSettings, acceptConfirm } from "./utils";
import * as path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("orphan repair", async ({ page }) => {
  console.log("Starting Orphan Repair Verification...");
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Inject Orphans
  console.log("Injecting orphans...");
  await page.evaluate(async () => {
    return new Promise<void>((resolve) => {
      // Open at the app's current version (no explicit version: a hardcoded
      // number rotted at every schema bump → VersionError against newer DBs).
      const req = window.indexedDB.open("EpubLibraryDB");
      req.onsuccess = (e: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => {
        const db = e.target.result;
        // Target active stores for maintenance
        const tx = db.transaction(["static_resources", "cache_render_metrics"], "readwrite");

        // Orphaned File -> static_resources
        tx.objectStore("static_resources").put({
          bookId: "orphan-book-id",
          epubBlob: new ArrayBuffer(10),
        });

        // Orphaned Metadata -> cache_render_metrics
        tx.objectStore("cache_render_metrics").put({
          bookId: "orphan-book-id",
          locations: JSON.stringify({ test: true }),
        });

        tx.oncomplete = () => resolve();
      };
    });
  });

  // Open Settings (Phase-10 SettingsShell route over the library). The bare
  // "Settings" accessible name is now ambiguous — it also matches the audio
  // deck's footer Settings tab — so drive the header button by test-id and
  // wait for the real Radix tablist via the shared helper.
  console.log("Opening Settings...");
  await openSettings(page);

  // Go to Data Management Tab (a real Radix role="tab" in the SettingsShell).
  await page.getByRole("tab", { name: "Data Management" }).scrollIntoViewIfNeeded().catch(() => {});
  await page.getByRole("tab", { name: "Data Management" }).click();

  // Click "Check & Repair Database"
  console.log("Running Repair...");
  await page.getByRole("button", { name: "Check & Repair Database" }).click();

  // The maintenance panel no longer uses window.confirm() — it renders an
  // in-app ConfirmDialog (useConfirm → ConfirmHost). A page.on('dialog', …)
  // handler would hang forever (no native dialog fires); accept by clicking
  // the dialog's confirm button so pruneOrphans() actually runs.
  await acceptConfirm(page);

  // Wait for result text
  console.log("Waiting for completion...");

  const successMsg = page.getByText("Repair complete. Orphans removed.");
  const healthyMsg = page.getByText("Database is healthy");

  try {
    // Wait for either to appear
    await expect(successMsg.or(healthyMsg)).toBeVisible({ timeout: 15000 });

    if (await healthyMsg.isVisible()) {
      throw new Error("Database reported healthy, but orphans were injected. Injection likely failed.");
    }

    await successMsg.scrollIntoViewIfNeeded();
    await expect(successMsg).toBeVisible();
  } catch (e) {
    // Capture screenshot on failure
    const screenshotsDir = path.resolve(__dirname, "screenshots");
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    const suffix = page.viewportSize()?.width && page.viewportSize()!.width < 600 ? "mobile" : "desktop";
    await page.screenshot({ path: path.join(screenshotsDir, `maintenance_fail_${suffix}.png`) });
    throw e;
  }

  // Verify orphans are gone via IDB check
  console.log("Verifying cleanup...");
  const orphansExist = await page.evaluate(async () => {
    return new Promise<boolean>((resolve) => {
      const req = window.indexedDB.open("EpubLibraryDB");
      req.onsuccess = (e: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => {
        const db = e.target.result;
        const tx = db.transaction(["static_resources", "cache_render_metrics"], "readonly");

        let fileExists = false;
        let metricsExists = false;

        const fileReq = tx.objectStore("static_resources").get("orphan-book-id");
        fileReq.onsuccess = () => {
          if (fileReq.result) fileExists = true;
        };

        const metricsReq = tx.objectStore("cache_render_metrics").get("orphan-book-id");
        metricsReq.onsuccess = () => {
          if (metricsReq.result) metricsExists = true;
        };

        tx.oncomplete = () => {
          resolve(fileExists || metricsExists);
        };
      };
    });
  });

  expect(orphansExist).toBe(false);
  console.log("Orphan repair verification successful.");
});
