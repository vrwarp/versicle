import type { Page } from '@playwright/test';
import { test, expect } from "./utils";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { Frame } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read tts-polyfill.js content
const ttsPolyfillPath = path.resolve(__dirname, 'tts-polyfill.js');
const ttsPolyfillContent = fs.readFileSync(ttsPolyfillPath, 'utf8');

function injectMockFirestore(page: Page, testUid: string) {
  const injectionCode = `
    window.__VERSICLE_MOCK_FIRESTORE__ = true;
    window.__VERSICLE_MOCK_USER_ID__ = '${testUid}';
    window.__VERSICLE_SANITIZATION_DISABLED__ = true;
    window.__VERSICLE_FIRESTORE_DEBOUNCE_MS__ = 20;
    window.__VERSICLE_MOCK_SYNC_DELAY__ = 10;
  `;
  page.addInitScript({ content: injectionCode });
  page.addInitScript({ content: ttsPolyfillContent });
}

function extractWorkspaceId(snapshot: unknown, testUid: string): string | null {
  if (!snapshot) return null;
  try {
    const snapshotDict = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot;
    for (const key of Object.keys(snapshotDict)) {
      if (key.includes(`users/${testUid}/versicle/ws_`)) {
        return key.split("/").pop() || null;
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

async function clearDataAndReload(page: Page, baseURL: string) {
  await page.goto(baseURL || "/");
  await page.evaluate(async () => {
    // Disconnect Yjs to release IDB locks
    if (typeof (window as any /* eslint-disable-line @typescript-eslint/no-explicit-any */).__DISCONNECT_YJS__ === 'function') {
      await (window as any /* eslint-disable-line @typescript-eslint/no-explicit-any */).__DISCONNECT_YJS__();
    }

    // Disconnect main DB connection to release IndexedDB locks
    if (typeof (window as any /* eslint-disable-line @typescript-eslint/no-explicit-any */).__CLOSE_DB__ === 'function') {
      await (window as any /* eslint-disable-line @typescript-eslint/no-explicit-any */).__CLOSE_DB__();
    }

    const dbs = await window.indexedDB.databases();
    for (const db of dbs) {
      if (db.name) {
        await new Promise<void>(resolve => {
          const req = window.indexedDB.deleteDatabase(db.name!);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        });
      }
    }
    localStorage.clear();
  });
  await page.reload();
  await expect(page.getByTestId("library-view")).toBeVisible({ timeout: 10000 });
}

async function pollForPersistence(page: Page, expectedKeyPattern: string, retries = 20, delay = 500): Promise<string | null> {
  for (let i = 0; i < retries; i++) {
    const snapshotStr = await page.evaluate("localStorage.getItem('versicle_mock_firestore_snapshot')");
    if (snapshotStr && snapshotStr.includes(expectedKeyPattern)) {
      return snapshotStr;
    }
    await page.waitForTimeout(delay);
  }
  return null;
}

function getReaderFrame(page: Page): Frame | null {
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame() && (frame.name().includes('epubjs') || frame.url().includes('blob:'))) {
      return frame;
    }
  }
  return null;
}

async function waitForReaderFrame(page: Page): Promise<Frame> {
  for (let i = 0; i < 20; i++) {
    const frame = getReaderFrame(page);
    if (frame) {
      await frame.locator("body").waitFor({ timeout: 5000 }).catch(() => {});
      return frame;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("Timeout waiting for reader iframe");
}

test("seamless handoff", async ({ browser, baseURL }) => {
  const testUid = `mock-user-${Math.random().toString(36).substring(2, 10)}`;
  const finalBaseURL = baseURL || "http://localhost:5173";

  // --- Device A ---
  console.log("\n[A] Setting up...");
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  pageA.on("console", (msg) => console.log(`[Page A] ${msg.text()}`));
  injectMockFirestore(pageA, testUid);
  await clearDataAndReload(pageA, finalBaseURL);

  // Import
  const alicePath = path.resolve(__dirname, "alice.epub");
  await pageA.setInputFiles("data-testid=hidden-file-input", alicePath);
  const bookCard = pageA.locator("[data-testid^='book-card-']").first();
  await expect(bookCard).toBeVisible({ timeout: 10000 });

  // Get Book ID
  const bookIdAttr = await bookCard.getAttribute("data-testid");
  if (!bookIdAttr) {
    throw new Error("Book card is missing data-testid");
  }
  // Open Reader
  await bookCard.click();
  await expect(pageA.getByTestId("reader-iframe-container")).toBeVisible({ timeout: 10000 });

  // Force create progress
  let progressConfirmed = false;

  for (let attempt = 0; attempt < 3; attempt++) {
    console.log(`[A] Progress Generation Attempt ${attempt + 1}`);

    if (await pageA.getByTestId("library-view").isVisible()) {
      await bookCard.click();
    }

    await expect(pageA.getByTestId("reader-iframe-container")).toBeVisible();
    await pageA.waitForFunction("window.rendition && window.rendition.location");
    // Wait for rendition manager and locations to be initialized (WebKit may need more time)
    await pageA.waitForFunction("window.rendition && window.rendition.manager").catch(() => {});
    await pageA.waitForFunction(
      "window.rendition && window.rendition.book && window.rendition.book.locations && window.rendition.book.locations.total() > 0",
      { timeout: 30000 }
    ).catch(() => {});

    // Generate progress reliably via a TOC jump. rendition.next() page turns are
    // a no-op on WebKit when rendition.manager is briefly undefined; a TOC jump to
    // a mid-book chapter relocates deterministically and persists non-zero progress.
    console.log("[A] Jumping to a mid-book chapter via TOC...");
    await pageA.getByTestId("reader-toc-button").click({ noWaitAfter: true });
    await pageA.waitForSelector('[data-testid="reader-toc-sidebar"]', { state: "visible", timeout: 8000 }).catch(() => {});
    await pageA.waitForSelector('[data-testid^="toc-item-"]', { state: "visible", timeout: 8000 }).catch(() => {});
    await pageA.getByTestId("toc-item-6").scrollIntoViewIfNeeded().catch(() => {});
    await pageA.getByTestId("toc-item-6").click({ force: true });
    await expect(pageA.getByTestId("reader-toc-sidebar")).not.toBeVisible();
    await pageA.waitForTimeout(2000);

    // A few extra page turns for additional progress (best-effort)
    const turns = attempt > 0 ? 6 : 3;
    for (let t = 0; t < turns; t++) {
      await pageA.keyboard.press("ArrowRight");
      await pageA.waitForTimeout(400);
    }

    // Go back to library
    await pageA.getByTestId("reader-back-button").click();
    await expect(pageA.getByTestId("library-view")).toBeVisible();

    const currentCard = pageA.locator("[data-testid^='book-card-']").first();
    const progressBar = currentCard.locator('[data-testid="progress-container"]');

    if (await progressBar.isVisible()) {
      console.log("[A] Progress verified in UI.");
      progressConfirmed = true;
      break;
    } else {
      console.log("[A] Progress bar not visible yet.");
    }
  }

  if (!progressConfirmed) {
    console.log("[A] WARNING: Failed to generate visible progress on Device A.");
  }

  // Wait a bit for final store debounce
  await pageA.waitForTimeout(2000);

  // Capture Sync State (Trigger push)
  await pageA.evaluate("window.dispatchEvent(new Event('beforeunload'))");

  // Wait for persistence
  const snapshotA = await pollForPersistence(pageA, `users/${testUid}/versicle/ws_`);
  if (!snapshotA) {
    throw new Error("Device A failed to sync");
  }

  // Extract the workspace ID from Device A's snapshot
  const wsId = extractWorkspaceId(snapshotA, testUid);

  if (!wsId) {
    throw new Error("Could not find workspace ID in Device A's snapshot");
  }
  console.log(`[A] Verified workspace ID: ${wsId}`);

  await pageA.close();
  await contextA.close();

  // --- Device B ---
  console.log("\n[B] Resuming...");
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  pageB.on("console", (msg) => console.log(`[Page B] ${msg.text()}`));
  injectMockFirestore(pageB, testUid);
  await pageB.goto(finalBaseURL);

  // Set localStorage values on the correct origin securely
  await pageB.evaluate(({ snapshot, workspaceId }) => {
    localStorage.setItem('versicle_mock_firestore_snapshot', typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot));
    if (workspaceId) {
      localStorage.setItem('__VERSICLE_WORKSPACES__', JSON.stringify([{
        workspaceId,
        name: 'My Library',
        createdAt: Date.now(),
        schemaVersion: 5
      }]));
    }
  }, { snapshot: snapshotA, workspaceId: wsId });

  await pageB.reload();
  await pageB.screenshot({ path: path.join(__dirname, "screenshots", "handoff_B_initial.png") });

  console.log("[B] Selecting workspace to start sync...");
  await pageB.getByTestId("header-settings-button").click();
  await pageB.waitForTimeout(1000);
  await pageB.getByRole("button", { name: "Sync & Cloud" }).click();

  await expect(pageB.getByTestId("sync-halt-warning")).toBeVisible({ timeout: 20000 });
  await pageB.getByRole("button", { name: "Switch" }).click();

  console.log("[B] Handling migration confirmation modal...");
  await expect(pageB.getByText("Finalize Workspace Switch?")).toBeVisible({ timeout: 15000 });
  await pageB.getByRole("button", { name: "Yes, Finalize" }).click();

  await expect(pageB.getByTestId("library-view")).toBeVisible({ timeout: 30000 });
  console.log("[B] Workspace finalized and reloaded");
  await pageB.screenshot({ path: path.join(__dirname, "screenshots", "handoff_B_synced.png") });

  // Wait for Ghost Book to appear
  const cardB = pageB.locator("[data-testid^='book-card-']").first();
  await expect(cardB).toBeVisible({ timeout: 10000 });

  // Check for offload overlay
  await expect(cardB.locator(".bg-black\\/20")).toBeVisible();

  // Click card to trigger Content Missing dialog
  await cardB.click({ force: true });

  // Supply the file
  await pageB.setInputFiles("data-testid=restore-file-input", alicePath);
  await pageB.waitForTimeout(2000);

  // Wait for restoration to complete
  await expect(pageB.getByRole("dialog")).toBeHidden({ timeout: 10000 });

  // Resume Reading
  console.log("[B] Checking for Resume Badge...");
  const resumeBadge = cardB.locator('[data-testid="resume-badge"]');

  if (await resumeBadge.isVisible()) {
    console.log("[B] Resume Badge visible. Clicking...");
    await resumeBadge.click({ force: true });
  } else {
    console.log("[B] Resume Badge not visible. Clicking card.");
    await cardB.click({ force: true });
  }

  await expect(pageB.getByTestId("reader-iframe-container")).toBeVisible({ timeout: 15000 });

  // Wait for rendition to load and calculate progress
  await pageB.waitForFunction("window.rendition && window.rendition.location");

  // Go back to library
  await pageB.getByTestId("reader-back-button").click();

  // Check progress via UI Progress Bar
  const finalProgressBar = cardB.locator('[data-testid="progress-container"]');
  await expect(finalProgressBar).toBeVisible({ timeout: 10000 });

  await pageB.close();
  await contextB.close();
});

test("note marker affordance", async ({ browser, baseURL }) => {
  const testUid = `mock-user-${Math.random().toString(36).substring(2, 10)}`;
  const finalBaseURL = baseURL || "http://localhost:5173";
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", (msg) => console.log(`[Page] ${msg.text()}`));
  injectMockFirestore(page, testUid);
  await clearDataAndReload(page, finalBaseURL);

  // Import book
  const alicePath = path.resolve(__dirname, "alice.epub");
  await page.setInputFiles("data-testid=hidden-file-input", alicePath);
  const bookCard = page.locator("[data-testid^='book-card-']").first();
  await expect(bookCard).toBeVisible({ timeout: 20000 });

  // Open Reader
  await bookCard.click();
  const readerContainer = page.getByTestId("reader-iframe-container");
  await expect(readerContainer).toBeVisible({ timeout: 10000 });

  // Wait for rendition to be ready
  await page.waitForFunction("window.rendition && window.rendition.location");
  await page.waitForTimeout(1000);

  // Jump straight to a content chapter via the TOC. Turning pages with
  // rendition.next() is unreliable on WebKit (leaves the reader on front-matter
  // with no <p>), whereas a TOC jump lands directly on rendered prose.
  await page.getByTestId("reader-toc-button").click({ noWaitAfter: true });
  await page.waitForSelector('[data-testid="reader-toc-sidebar"]', { state: "visible", timeout: 8000 }).catch(() => {});
  await page.waitForSelector('[data-testid^="toc-item-"]', { state: "visible", timeout: 8000 }).catch(() => {});
  await page.getByTestId("toc-item-6").scrollIntoViewIfNeeded().catch(() => {});
  await page.getByTestId("toc-item-6").click({ force: true });
  await expect(page.getByTestId("reader-toc-sidebar")).not.toBeVisible();
  await page.waitForTimeout(1500);

  // Resolve the rendered content frame and confirm prose is present
  let frame = await waitForReaderFrame(page);
  await expect(frame.locator("p").first()).toBeVisible({ timeout: 20000 });
  frame = await waitForReaderFrame(page);

  const pLocator = frame.locator("p").first();
  await page.waitForTimeout(1000); // Wait for layout stability

  await pLocator.evaluate((element) => {
    const range = document.createRange();
    const textNode = element.firstChild;
    if (textNode && textNode.nodeType === 3) {
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(10, (textNode as Text).length || 0));
    } else {
      range.selectNodeContents(element);
    }

    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  });

  // Check if annotation menu appears
  await expect(page.getByTestId("compass-pill-annotation")).toBeVisible({ timeout: 5000 });

  // Click "Add Note" button
  await page.getByTestId("popover-add-note-button").click();

  // Fill note dialog
  await expect(page.getByTestId("compass-pill-annotation-edit")).toBeVisible();
  await page.locator("textarea").fill("This is a test note");
  await page.getByRole("button", { name: "Save" }).click();

  // Verify Note Marker exists and is visible in the iframe
  const marker = page.getByTestId("note-marker").first();
  await expect(marker).toBeVisible({ timeout: 5000 });

  // Verify styles (Yellow background)
  const styleCount = await frame.locator("head style[id='reader-static-styles']").count();
  console.log(`Found ${styleCount} static style tags in iframe head`);

  const styles = await marker.evaluate((el) => {
    const style = window.getComputedStyle(el);
    return {
      bg: style.backgroundColor,
      width: style.width,
      height: style.height,
      display: style.display,
    };
  });
  console.log(`Marker Styles: ${JSON.stringify(styles)}`);

  const isYellow =
    styles.bg.includes("253") ||
    styles.bg.includes("fde047") ||
    styles.bg.includes("98.111") ||
    styles.bg.includes("oklch");
  expect(isYellow).toBe(true);

  await page.close();
  await context.close();
});

test("offline resilience", async ({ browser, baseURL }) => {
  const testUid = `mock-user-${Math.random().toString(36).substring(2, 10)}`;
  const finalBaseURL = baseURL || "http://localhost:5173";

  // --- Device A ---
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();

  injectMockFirestore(pageA, testUid);
  await clearDataAndReload(pageA, finalBaseURL);

  // Add Lexicon Rule
  await pageA.getByTestId("header-settings-button").click();
  await pageA.getByRole("button", { name: "Dictionary" }).click();
  await pageA.getByRole("button", { name: "Manage Rules" }).click();
  await pageA.getByTestId("lexicon-add-rule-btn").click();
  await pageA.fill("data-testid=lexicon-input-original", "Offline");
  await pageA.fill("data-testid=lexicon-input-replacement", "Online");
  await pageA.click("data-testid=lexicon-save-rule-btn");

  // Allow Yjs/Store to propagate changes
  await pageA.waitForTimeout(1000);

  // Flush sync
  await pageA.evaluate("window.dispatchEvent(new Event('beforeunload'))");
  await pageA.evaluate("window.dispatchEvent(new Event('beforeunload'))");

  const snapshotA = await pollForPersistence(pageA, `users/${testUid}/versicle/ws_`);
  if (!snapshotA) {
    throw new Error("Device A failed to persist data to mock cloud");
  }
  await pageA.waitForTimeout(2000);
  const finalSnapshot = await pageA.evaluate("localStorage.getItem('versicle_mock_firestore_snapshot')");
  const parsedSnapshot = JSON.parse(finalSnapshot!);

  await pageA.close();
  await contextA.close();

  // --- Device B ---
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  pageB.on("console", (msg) => console.log(`[Page B] ${msg.text()}`));
  injectMockFirestore(pageB, testUid);
  await pageB.goto(finalBaseURL);

  const wsId = extractWorkspaceId(parsedSnapshot, testUid);

  // Set localStorage values on the correct origin securely
  await pageB.evaluate(({ snapshot, workspaceId }) => {
    localStorage.setItem('versicle_mock_firestore_snapshot', typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot));
    if (workspaceId) {
      localStorage.setItem('__VERSICLE_WORKSPACES__', JSON.stringify([{
        workspaceId,
        name: 'My Library',
        createdAt: Date.now(),
        schemaVersion: 5
      }]));
    }
  }, { snapshot: parsedSnapshot, workspaceId: wsId });

  await pageB.reload();

  console.log("[B] Selecting workspace to start sync...");
  await pageB.getByTestId("header-settings-button").click();
  await pageB.waitForTimeout(1000);
  await pageB.getByRole("button", { name: "Sync & Cloud" }).click();

  await expect(pageB.getByTestId("sync-halt-warning")).toBeVisible({ timeout: 20000 });
  await pageB.getByRole("button", { name: "Switch" }).click();

  console.log("[B] Handling migration confirmation modal...");
  await expect(pageB.getByText("Finalize Workspace Switch?")).toBeVisible({ timeout: 15000 });
  await pageB.getByRole("button", { name: "Yes, Finalize" }).click();

  await expect(pageB.getByTestId("library-view")).toBeVisible({ timeout: 30000 });
  console.log("[B] Workspace finalized and reloaded");

  await expect(pageB.getByTestId("library-view")).toBeVisible({ timeout: 10000 });

  // Give sync manager time to process
  await pageB.waitForTimeout(5000);

  // Check Settings
  await pageB.getByTestId("header-settings-button").click();
  await pageB.getByRole("button", { name: "Dictionary" }).click();
  await pageB.getByRole("button", { name: "Manage Rules" }).click();

  console.log("Waiting for synced lexicon rule 'Offline'...");
  let ruleVisible = false;
  for (let i = 0; i < 80; i++) {
    if (await pageB.getByText("Offline").isVisible()) {
      ruleVisible = true;
      break;
    }

    if (i > 0 && i % 10 === 0) {
      console.log(`Retry ${i / 10}: Closing and re-opening dialog...`);
      await pageB.keyboard.press("Escape");
      await pageB.waitForTimeout(500);
      await pageB.keyboard.press("Escape");
      await pageB.waitForTimeout(1000);

      await pageB.getByTestId("header-settings-button").click();
      await pageB.waitForTimeout(1000);

      const dictionaryBtn = pageB.getByRole("button", { name: "Dictionary" });
      await dictionaryBtn.scrollIntoViewIfNeeded();
      await expect(dictionaryBtn).toBeVisible({ timeout: 5000 });
      await dictionaryBtn.click({ force: true });

      await pageB.waitForTimeout(500);
      await expect(pageB.getByRole("button", { name: "Manage Rules" })).toBeVisible({ timeout: 5000 });
      await pageB.getByRole("button", { name: "Manage Rules" }).click({ force: true });
      await pageB.waitForTimeout(500);
    }
    await pageB.waitForTimeout(500);
  }

  if (!ruleVisible) {
    console.log("Rule not visible after wait. capturing screenshot...");
    await pageB.screenshot({ path: path.join(__dirname, "screenshots", "sync_fail_mobile_debug.png") });
    await expect(pageB.getByText("Offline")).toBeVisible({ timeout: 1000 });
  } else {
    console.log("Rule synced and visible!");
    await expect(pageB.getByText("Offline")).toBeVisible();
  }

  await pageB.close();
  await contextB.close();
});

test("data liberation", async ({ browser, baseURL }) => {
  const testUid = `mock-user-${Math.random().toString(36).substring(2, 10)}`;
  const finalBaseURL = baseURL || "http://localhost:5173";
  const context = await browser.newContext();
  const page = await context.newPage();
  injectMockFirestore(page, testUid);
  await clearDataAndReload(page, finalBaseURL);

  // Create some data
  await page.getByTestId("header-settings-button").click();
  await page.getByRole("button", { name: "Dictionary" }).click();
  await page.getByRole("button", { name: "Manage Rules" }).click();
  await page.getByTestId("lexicon-add-rule-btn").click();
  await page.fill("data-testid=lexicon-input-original", "ExportMe");
  await page.fill("data-testid=lexicon-input-replacement", "ImportMe");
  await page.click("data-testid=lexicon-save-rule-btn");

  // Reload to ensure clean state
  await page.reload();
  await expect(page.getByTestId("library-view")).toBeVisible();

  // Open Data Management
  await page.getByTestId("header-settings-button").click();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Data Management" }).click({ force: true });

  // Trigger Quick JSON Export
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Quick JSON Export" }).click({ force: true });
  const download = await downloadPromise;

  const tempPath = path.resolve(__dirname, `export_${Math.random().toString(36).substring(2, 10)}.json`);
  await download.saveAs(tempPath);

  // Validate JSON
  const fileContent = fs.readFileSync(tempPath, "utf8");
  const data = JSON.parse(fileContent);

  expect(data.version).toBe(2);
  expect(data).toHaveProperty("yjsSnapshot");
  expect(data).toHaveProperty("semanticData");

  fs.unlinkSync(tempPath);
  await page.close();
  await context.close();
});
