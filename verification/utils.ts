/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, expect } from '@playwright/test';
import type { Page, Frame } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read tts-polyfill.js content
const ttsPolyfillPath = path.resolve(__dirname, 'tts-polyfill.js');
const ttsPolyfillContent = fs.readFileSync(ttsPolyfillPath, 'utf8');

// Optional IndexedDB / event-loop probe (TTS_IDB_PROBE=1). Injected before the app so
// it can wrap IndexedDB and measure hung transactions + event-loop stalls.
const idbProbePath = path.resolve(__dirname, '_idb_probe.js');
const idbProbeContent = fs.existsSync(idbProbePath) ? fs.readFileSync(idbProbePath, 'utf8') : '';

// Record<never, never> (no keys) rather than Record<string, never>: the latter's
// string index signature intersects the worker-fixture types and collapses
// `_suppressLogs` to `never`, rejecting the fixture tuple below.
export const test = base.extend<Record<never, never>, { _suppressLogs: void }>({
  // Worker-scoped: runs once per worker process (not per test).
  // Patches console.log/info/debug to noop so spec-file log calls are
  // silent by default. Set DEBUG_PAGE_LOGS=1 to restore them.
  _suppressLogs: [
    async ({}, use) /* eslint-disable-line no-empty-pattern */ => {
      if (!process.env.DEBUG_PAGE_LOGS) {
        const noop = () => {};
        console.log = noop;
        console.info = noop;
        console.debug = noop;
        // warn/error kept so failures stay visible
      }
      await use();
    },
    { scope: 'worker', auto: true },
  ],

  // NOTE: We deliberately use Playwright's default shared-browser-per-worker model.
  // An earlier "fresh WebKit browser per test" override was added to dodge long-run
  // instance degradation — but that degradation was caused by the IndexedDB hangs
  // (Yjs persistence + cache_session_state), which are now fixed at the source. The
  // per-test browser launch added its own cost: ~one WebKit process launch/teardown
  // per test across the serial run, whose memory churn occasionally crashed the
  // renderer ("Target crashed"). The shared per-worker browser avoids that churn.
  // Trace-on-first-retry is handled by playwright.config.ts (use.trace).

  page: async ({ page }, use, testInfo) => {
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(10000);

    if (process.env.DEBUG_PAGE_LOGS) {
      page.on('console', (msg) => console.log(`PAGE LOG: ${msg.text()}`));
      page.on('pageerror', (err) => console.error(`PAGE ERROR: ${err}`));
    }

    if (process.env.TTS_IDB_PROBE && idbProbeContent) {
      await page.addInitScript({ content: idbProbeContent });
    }
    await page.addInitScript({ content: ttsPolyfillContent });
    await page.addInitScript({ content: 'window.__VERSICLE_SANITIZATION_DISABLED__ = true;' });

    await use(page);

    // Dump the probe (and TTS flight-recorder tail) after the test body. For a timed-out
    // test this captures the wedge state: any IDB txn still outstanding here is a hang.
    if (process.env.TTS_IDB_PROBE) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const summary = await page.evaluate(() => (window as any).__idbProbe?.summary?.() ?? null);
        const fr = await page.evaluate(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const f = (window as any).__ttsFlightRecorder;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return f?.export ? f.export().slice(-40).map((e: any) => `${e.src}.${e.ev}`) : [];
        });
        console.error(`\n[IDBPROBE] "${testInfo.title}" status=${testInfo.status}\n  probe=${JSON.stringify(summary)}\n  fr=${JSON.stringify(fr)}`);
      } catch (e) {
        console.error(`[IDBPROBE] dump failed for "${testInfo.title}": ${e}`);
      }
    }
  },
});

export { expect };

export async function navigateToChapter(page: Page, chapterId: string = 'toc-item-6') {
  console.log(`Navigating to chapter: ${chapterId}...`);
  await page.getByTestId('reader-toc-button').click({ noWaitAfter: true });
  // Wait for sidebar and items to be ready before clicking (WebKit animations can be slower)
  await page.waitForSelector('[data-testid="reader-toc-sidebar"]', { state: 'visible', timeout: 8000 }).catch(() => {});
  await page.waitForSelector('[data-testid^="toc-item-"]', { state: 'visible', timeout: 8000 }).catch(() => {});
  // Scroll target chapter into view before clicking (needed when TOC item is off-screen)
  await page.getByTestId(chapterId).scrollIntoViewIfNeeded().catch(() => {});
  await page.getByTestId(chapterId).click({ force: true });

  await expect(page.getByTestId('reader-toc-sidebar')).not.toBeVisible();

  await page.locator('body').click({ position: { x: 100, y: 100 } });

  await expect(page.getByTestId('compass-pill-active')).toBeVisible();
  await page.waitForTimeout(1000);
}

export async function resetApp(page: Page) {
  await page.goto('/', { timeout: 10000 });
  await page.reload();

  await page.evaluate(async () => {
    // Disconnect Yjs to release IDB locks
    if (typeof (window as any /* eslint-disable-line @typescript-eslint/no-explicit-any */).__DISCONNECT_YJS__ === 'function') {
      await (window as any /* eslint-disable-line @typescript-eslint/no-explicit-any */).__DISCONNECT_YJS__();
    }

    // Disconnect main DB connection to release IndexedDB locks
    if (typeof (window as any /* eslint-disable-line @typescript-eslint/no-explicit-any */).__CLOSE_DB__ === 'function') {
      await (window as any /* eslint-disable-line @typescript-eslint/no-explicit-any */).__CLOSE_DB__();
    }

    // Unregister Service Workers (with timeout — WebKit's unregister() can hang indefinitely)
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await Promise.race([
          registration.unregister(),
          new Promise<void>(resolve => setTimeout(resolve, 2000)),
        ]);
      }
    }

    // Clear DBs
    const dbs = await window.indexedDB.databases();
    for (const db of dbs) {
      if (db.name) {
        await new Promise<void>((resolve, reject) => {
          const req = window.indexedDB.deleteDatabase(db.name!);
          req.onsuccess = () => resolve();
          req.onerror = reject;
          req.onblocked = () => {
            console.warn(`DB ${db.name} deletion blocked`);
            resolve();
          };
        });
      }
    }
    localStorage.clear();
  });

  await page.reload();

  try {
    try {
      await page.waitForSelector('text=Updating Library', { state: 'detached', timeout: 10000 });
    } catch {
      // Ignore
    }

    await page.waitForSelector(
      "[data-testid^='book-card-'], button:has-text('Load Demo Book'), :text('Your library is empty')",
      { timeout: 45000 }
    );
  } catch (err) {
    console.warn(`Warning: App load state check failed: ${err}`);
    await captureScreenshot(page, 'reset_app_timeout_debug');
  }
}

/**
 * Wait for the app's debounced IndexedDB writes to reach disk before a hard `page.reload()`.
 *
 * Persistence is intentionally debounced and coalesced through a single in-flight transaction
 * to avoid the WebKit IndexedDB hangs that motivated the y-idb migration:
 *   - Yjs state (e.g. reading progress / TTS `currentQueueIndex`) → y-idb, writeDebounceMs=200
 *   - DBService `cache_session_state` (e.g. the TTS playback queue) → 500ms debounce
 * Both flush asynchronously and cannot be guaranteed to commit during page teardown, so a
 * `page.reload()` issued immediately after a write tears the page down with the bytes still
 * buffered — and the state is gone after reload. Tests that assert "X survives a reload" must
 * let those windows drain first (the in-SPA navigation tests already wait ~1s "to persist").
 *
 * The wait comfortably exceeds the longest debounce (500ms) plus write time; once the test
 * goes idle here no new writes are issued, so the timers fire and the queued writes complete.
 */
export async function waitForPersistedWrites(page: Page) {
  await page.waitForTimeout(1500);
}

export async function ensureLibraryWithBook(page: Page) {
  try {
    await page.waitForSelector(
      "[data-testid^='book-card-'], button:has-text('Load Demo Book'), :text('Your library is empty')",
      { timeout: 45000 }
    );
  } catch (err) {
    console.warn(`Warning: Neither book card nor load button found within 45s: ${err}`);
    await captureScreenshot(page, 'ensure_library_timeout_debug');
  }

  if ((await page.getByText("Alice's Adventures in Wonderland").count()) > 0) {
    return;
  }

  let loadBtn = page.getByRole('button', { name: 'Load Demo Book' });
  if ((await loadBtn.count()) === 0) {
    loadBtn = page.locator('button').filter({ hasText: 'Load Demo Book' });
  }

  if ((await loadBtn.count()) > 0 && (await loadBtn.first().isVisible())) {
    await loadBtn.first().click();
    try {
      await page.waitForSelector("[data-testid^='book-card-']", { timeout: 30000 });
    } catch {
      if (await loadBtn.first().isVisible()) {
        await loadBtn.first().click();
        await page.waitForSelector("[data-testid^='book-card-']", { timeout: 30000 });
      }
    }
  }
}

export async function captureScreenshot(page: Page, name: string, hideTtsStatus: boolean = false) {
  const screenshotsDir = path.resolve(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  if (hideTtsStatus) {
    await page.evaluate(() => {
      const el = document.getElementById('tts-debug');
      if (el) {
        el.style.visibility = 'hidden';
      }
    });
    try {
      await page.locator('#tts-debug').waitFor({ state: 'hidden', timeout: 1000 });
    } catch {
      // Ignore
    }
  }

  const viewport = page.viewportSize();
  const width = viewport ? viewport.width : 1280;
  const suffix = width < 600 ? 'mobile' : 'desktop';
  await page.screenshot({ path: path.join(screenshotsDir, `${name}_${suffix}.png`), timeout: 10000 });

  if (hideTtsStatus) {
    await page.evaluate(() => {
      const el = document.getElementById('tts-debug');
      if (el) {
        el.style.visibility = 'visible';
      }
    });
  }
}

export function getReaderFrame(page: Page): Frame | null {
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame() && (frame.name().includes('epubjs') || frame.url().includes('blob:'))) {
      return frame;
    }
  }
  return null;
}
