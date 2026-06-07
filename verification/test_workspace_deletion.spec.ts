import { test, expect } from "./utils";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read tts-polyfill.js content
const ttsPolyfillPath = path.resolve(__dirname, 'tts-polyfill.js');
const ttsPolyfillContent = fs.readFileSync(ttsPolyfillPath, 'utf8');

test("workspace deletion tombstone", async ({ browser, baseURL }) => {
  // Two-phase journey (create+delete a workspace, then a fresh stale-client detects the
  // tombstone). It runs in ~8s nominally but spans two browser contexts, multiple reloads
  // and a cross-context sync event, so the default 30s budget is too tight under parallel
  // load. test.slow() triples it (90s desktop/mobile, 360s webkit) — comfortably above the
  // internal waits below.
  test.slow();
  const finalBaseURL = baseURL || "http://localhost:5173";
  const testUid = `mock-user-${Math.random().toString(36).substring(2, 10)}`;

  // ============================================
  // STEP 1: Create & Delete Workspace
  // ============================================
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (msg) => console.log(`[APP] ${msg.text()}`));
  page.on("pageerror", (err) => console.error(`[APP ERROR] ${err}`));

  await page.addInitScript({ content: `window.__VERSICLE_MOCK_FIRESTORE__ = true; window.__VERSICLE_MOCK_USER_ID__ = '${testUid}';` });
  await page.addInitScript({ content: "window.__VERSICLE_SANITIZATION_DISABLED__ = true;" });
  await page.addInitScript({ content: ttsPolyfillContent });

  await page.goto(finalBaseURL);
  await expect(page.getByTestId("library-view")).toBeVisible({ timeout: 15000 });

  // Go to Sync Settings
  await page.getByTestId("header-settings-button").click();
  await page.getByRole("button", { name: "Sync & Cloud" }).click();

  // In mock mode, sync is auto-enabled without pasting config
  await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();

  // Create new workspace
  const wsName = "To Be Deleted";
  await page.getByPlaceholder("New workspace name").fill(wsName);
  await page.getByRole("button", { name: "Create" }).click();

  // Wait for creation
  await expect(page.getByText(wsName).first()).toBeVisible();
  console.log(`Created workspace: ${wsName}`);

  // Wait for the workspaces block to refresh and become stable
  await page.waitForTimeout(1000);

  // Get the workspace ID
  const wsId = await page.evaluate(() => JSON.parse(localStorage.getItem('sync-storage') || '{}').state.activeWorkspaceId);
  expect(wsId).not.toBeNull();
  expect(wsId.startsWith("ws_")).toBe(true);
  console.log(`Workspace ID: ${wsId}`);

  // Add some data (Lexicon rule)
  await page.getByRole("button", { name: "Dictionary" }).click();
  await page.getByRole("button", { name: "Manage Rules" }).click();
  await page.getByTestId("lexicon-add-rule-btn").click();
  await page.getByTestId("lexicon-input-original").fill("DeleteMe");
  await page.getByTestId("lexicon-input-replacement").fill("Deleted");
  await page.getByTestId("lexicon-save-rule-btn").click();
  await expect(page.getByText("DeleteMe")).toBeVisible();

  // Close Lexicon & go back to Sync & Cloud
  await page.getByTestId("lexicon-close-btn").click();
  await page.getByRole("button", { name: "Sync & Cloud" }).click();

  // Create a second workspace so we can delete the first one.
  await page.getByPlaceholder("New workspace name").fill("Safe Workspace");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText('Safe Workspace').first()).toBeVisible();

  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(__dirname, "screenshots", "deletion_list.png") });
  console.log("Screenshot saved: deletion_list.png");

  // Find the non-active "To Be Deleted" workspace and delete it
  const wsItem = page.locator("div.text-sm.bg-muted\\/50").filter({ hasText: wsId }).first();
  await expect(wsItem).toBeVisible();

  const deleteBtn = wsItem.locator("svg.lucide-trash-2").locator("xpath=ancestor::button[1]");

  // Handle confirm dialog
  page.once("dialog", (dialog) => {
    console.log(`DIALOG: ${dialog.message()}`);
    dialog.accept();
  });
  await deleteBtn.click({ force: true });
  await page.waitForTimeout(1000);

  try {
    await expect(page.getByText(`Workspace "${wsName}" deleted.`)).toBeVisible({ timeout: 5000 });
  } catch {
    console.log("Toast may have disappeared, proceeding to check if workspace is gone.");
  }

  console.log("Workspace deleted successfully");

  // Verify it's gone from the list
  await expect(page.getByText(wsId)).not.toBeVisible();

  // Capture mock storage state
  const mockStorage = await page.evaluate(() => localStorage.getItem('versicle_mock_firestore_snapshot'));
  expect(mockStorage).not.toBeNull();
  const mockData = JSON.parse(mockStorage!);
  const dbPath = `users/${testUid}/versicle/${wsId}`;
  expect(mockData).toHaveProperty(dbPath);
  expect(mockData[dbPath].isDeleted).toBe(true);
  console.log("Tombstone verified in mock storage");

  await page.close();
  await context.close();

  // ============================================
  // STEP 2: Stale Client Detection
  // ============================================
  console.log("\n========== Testing Stale Client Detection ==========");
  const contextStale = await browser.newContext();
  const pageStale = await contextStale.newPage();

  pageStale.on("console", (msg) => console.log(`[STALE] ${msg.text()}`));
  pageStale.on("pageerror", (err) => console.error(`[STALE ERROR] ${err}`));

  await pageStale.addInitScript({ content: `window.__VERSICLE_MOCK_FIRESTORE__ = true; window.__VERSICLE_MOCK_USER_ID__ = '${testUid}';` });
  await pageStale.addInitScript({ content: "window.__VERSICLE_SANITIZATION_DISABLED__ = true;" });
  await pageStale.addInitScript({ content: ttsPolyfillContent });

  await pageStale.goto(finalBaseURL);

  // Set localStorage values on the correct origin securely (appending, not overwriting!)
  await pageStale.evaluate(({ deletedWsId, uid }) => {
    let snapshot: Record<string, unknown> = {};
    const existing = localStorage.getItem('versicle_mock_firestore_snapshot');
    if (existing) {
      try {
        snapshot = JSON.parse(existing);
      } catch { /* empty */ }
    }
    snapshot[`users/${uid}/versicle/${deletedWsId}`] = { isDeleted: true, deletedAt: Date.now() };
    localStorage.setItem('versicle_mock_firestore_snapshot', JSON.stringify(snapshot));

    const syncStorage = {
      state: {
        activeWorkspaceId: deletedWsId,
        hasCompletedOnboarding: true,
        firebaseEnabled: true,
        firebaseConfig: {
          apiKey: "dummy-api-key",
          authDomain: "dummy.firebaseapp.com",
          projectId: "dummy-project",
          appId: "dummy-app-id"
        }
      },
      version: 0
    };
    localStorage.setItem('sync-storage', JSON.stringify(syncStorage));
  }, { deletedWsId: wsId, uid: testUid });

  await pageStale.reload();

  // Tombstone detection runs during sync-connect on load. It (a) shows a transient
  // 8s toast and (b) persistently clears the active workspace id from sync-storage.
  // The toast can be missed during WebKit's slower, noisier cold start, so the
  // persistent state change is the authoritative signal; the toast is best-effort.
  await pageStale
    .getByText("Sync disconnected: Remote workspace was deleted.", { exact: false })
    .waitFor({ state: "visible", timeout: 15000 })
    .then(() => console.log("Stale client showed the disconnect toast"))
    .catch(() => console.log("Disconnect toast not observed; verifying persistent effect instead"));

  // Authoritative: the deleted workspace id must be severed from local sync state.
  await expect
    .poll(
      () =>
        pageStale.evaluate(
          () => JSON.parse(localStorage.getItem("sync-storage") || "{}").state?.activeWorkspaceId ?? null
        ),
      { timeout: 25000 }
    )
    .not.toBe(wsId);
  console.log("Stale client correctly cleared the deleted workspace ID");

  await pageStale.close();
  await contextStale.close();
  console.log("\n========== TEST PASSED: Workspace Tombstoning Verified! ==========");
});
