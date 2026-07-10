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
/**
 * The typed page-side test API installed by src/test-api.ts (DEV and
 * VITE_E2E builds only). Mirrored here because tsconfig.e2e.json does not
 * include src/.
 */
interface VersicleTestApi {
  flushPersistence(): Promise<void>;
  resetApp(): Promise<void>;
  disconnectYjs(): Promise<void>;
  closeDb(): Promise<void>;
  /**
   * GenAI mock seam (Phase 7): swaps the composition-root GenAIClient for a
   * mock primed with the fixture (replaces the deleted
   * `localStorage.mockGenAIResponse` production seam). Runtime-settable —
   * call after boot/reload, before triggering the AI feature under test.
   */
  genai: {
    setMock(fixture: { response?: unknown; error?: string; delayMs?: number }): void;
    /** Toggles the GenAI content-analysis debug mode (P6 overlay characterization seam). */
    setDebugMode(enabled: boolean): void;
  };
  /**
   * Seeds a content-analysis result for one section (P6 entry gate) so the
   * debug-highlight layer renders without a real GenAI round-trip.
   */
  seedContentAnalysis(
    bookId: string,
    sectionId: string,
    payload: { referenceStartCfi: string },
  ): void;
  /**
   * TTS playback commands (Phase 9): the typed replacement for the
   * play/pause half of the deleted `window.useTTSStore` main.tsx shim.
   * State reads go through `window.useTTSPlaybackStore` directly.
   */
  tts: {
    play(): void;
    pause(): void;
  };
  /**
   * Typed reader predicates over the live ReaderEngine (Phase 6 §2b) — the
   * named replacements for the exact `window.rendition` /
   * `__reader_added_annotations_count` polls this suite used to do. All
   * methods are safe before a reader mounts (null/0/false).
   */
  reader: {
    isReady(): boolean;
    currentCfi(): string | null;
    currentHref(): string | null;
    locationsTotal(): number;
    hasManager(): boolean;
    highlightCount(layer: 'annotation' | 'tts' | 'history' | 'debug' | 'search'): number;
    next(): Promise<void>;
    prev(): Promise<void>;
    display(target: string): Promise<void>;
  };
}

declare global {
  interface Window {
    __versicleTest?: VersicleTestApi;
  }
}

export const test = base.extend<{ sanitizationDisabled: boolean }, { _suppressLogs: void }>({
  // Sanitization kill-switch injected before app boot. Historically forced ON
  // for the whole suite (the documented honesty gap: CFIs are computed
  // post-sanitize in both pipelines, but the suite measured them with
  // sanitization off). The P6 characterization specs opt OUT via
  // `test.use({ sanitizationDisabled: false })` so overlay/pinyin geometry is
  // pinned against the REAL sanitize path; existing specs keep the legacy
  // default until the Phase 6 engine work retires the flag.
  sanitizationDisabled: [true, { option: true }],
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

  page: async ({ page, sanitizationDisabled }, use, testInfo) => {
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
    if (sanitizationDisabled) {
      await page.addInitScript({ content: 'window.__VERSICLE_SANITIZATION_DISABLED__ = true;' });
    }

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
    // Unregister Service Workers (with timeout — WebKit's unregister() can hang indefinitely)
    const unregisterServiceWorkers = async () => {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await Promise.race([
            registration.unregister(),
            new Promise<void>(resolve => setTimeout(resolve, 2000)),
          ]);
        }
      }
    };

    // Preferred path: the typed test API (DEV/VITE_E2E builds). Its resetApp
    // delegates to the app's own wipeAllData() — flush + close every writer,
    // delete both app databases, clear Versicle-owned localStorage and caches.
    const api = window.__versicleTest;
    if (api?.resetApp) {
      await unregisterServiceWorkers();
      try {
        await api.resetApp();
      } catch (err) {
        // wipeAllData throws when a deletion is blocked by another holder;
        // surface it but let the reload below proceed (legacy behavior).
        console.warn(`__versicleTest.resetApp reported: ${err}`);
      }
      localStorage.clear();
      return;
    }

    // Legacy fallback (builds where resetApp is unavailable).
    // Disconnect Yjs to release IDB locks
    await api?.disconnectYjs?.();

    // Disconnect main DB connection to release IndexedDB locks
    await api?.closeDb?.();

    await unregisterServiceWorkers();

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
 * let those windows drain first.
 *
 * Deterministic path: `window.__versicleTest.flushPersistence()` (src/test-api.ts,
 * installed in DEV/VITE_E2E builds) forces both queues to flush NOW and resolves when the
 * transactions have committed — no timing knowledge duplicated here. The 1500ms sleep
 * remains only as a fallback for stale builds without the API, so a mismatched app build
 * degrades to the old slow-but-safe behavior instead of flaking.
 */
export async function waitForPersistedWrites(page: Page) {
  const flushed = await page.evaluate(async () => {
    const api = window.__versicleTest;
    if (!api?.flushPersistence) return false;
    await api.flushPersistence();
    return true;
  });
  if (!flushed) {
    console.warn(
      'waitForPersistedWrites: window.__versicleTest.flushPersistence unavailable ' +
      '(app built without DEV/VITE_E2E?) — falling back to the legacy 1500ms sleep.'
    );
    await page.waitForTimeout(1500);
  }
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

/**
 * Accept the in-app confirmation dialog (the Phase-8 ConfirmHost Modal).
 *
 * The overhaul replaced the legacy `window.confirm(...)` calls — which a spec
 * caught via `page.on('dialog', d => d.accept())` — with a Radix
 * `ConfirmDialog` (src/components/ui/ConfirmDialog.tsx). Destructive flows
 * (e.g. deleting an annotation, src/components/reader/AnnotationList.tsx:30-35)
 * now `await useConfirm()` and only proceed once this button is clicked, so
 * the native-dialog listener never fires. Waits for the dialog, then clicks
 * its confirm affordance.
 */
export async function acceptConfirm(page: Page) {
  await expect(page.getByTestId('confirm-dialog')).toBeVisible({ timeout: 10000 });
  await page.getByTestId('confirm-dialog-confirm').click();
}

/** Open Global Settings from the library header and wait for the tablist. */
export async function openSettings(page: Page) {
  await page.getByTestId('header-settings-button').click();
  await expect(page.getByRole('tablist', { name: 'Settings sections' })).toBeVisible({ timeout: 10000 });
}

/**
 * Navigate to a specific settings tab and confirm it is selected.
 * id ∈ general|tts|genai|sync|devices|dictionary|recovery|diagnostics|data
 */
export async function gotoSettingsTab(page: Page, id: string) {
  // On the mobile (375x667) vertical tablist the lower tabs (data/recovery/
  // diagnostics) sit below the fold — scroll before clicking.
  await page.getByTestId(`settings-tab-${id}`).scrollIntoViewIfNeeded().catch(() => {});
  await page.getByTestId(`settings-tab-${id}`).click();
  await expect(page.getByTestId(`settings-tab-${id}`)).toHaveAttribute('aria-selected', 'true');
}

/**
 * Open the audio deck and switch to its Settings view. The "Settings" footer tab
 * (tts-settings-tab-btn) lives in the Sheet footer and is often below the fold,
 * so it must be scrolled into view before clicking.
 */
export async function openAudioSettings(page: Page) {
  await page.getByTestId('reader-audio-button').click();
  await expect(page.getByTestId('tts-panel')).toBeVisible();
  const btn = page.getByTestId('tts-settings-tab-btn');
  await btn.scrollIntoViewIfNeeded();
  // On the mobile (375px) Sheet the scrollable tts-queue body overlaps the
  // footer tab's centerpoint, so Playwright's actionability check reports
  // "tts-queue intercepts pointer events" on the (visible, enabled, stable)
  // button. The footer tab is a real affordance; force past the centerpoint.
  await btn.click({ force: true });
  await expect(page.getByText('Voice & Pace')).toBeVisible();
}

/**
 * Switch the (already-open) Audio Deck Sheet between its "Up Next" and "Settings" views.
 * The view-toggle buttons live in the Sheet footer below the fold, so scroll into view first.
 */
export async function switchAudioPanelView(page: Page, view: 'queue' | 'settings') {
  const testId = view === 'settings' ? 'tts-settings-tab-btn' : 'tts-queue-tab-btn';
  const btn = page.getByTestId(testId);
  await btn.waitFor({ state: 'visible' });
  await btn.scrollIntoViewIfNeeded();
  // Force past the mobile Sheet's tts-queue centerpoint interception (see openAudioSettings).
  await btn.click({ force: true });
}

/**
 * Close the Global Settings overlay (SettingsShell) and wait for the Radix Dialog
 * backdrop to fully detach. Closing is a history navigation, so the ModalOverlay
 * lingers one frame; failing to await it leaves the backdrop intercepting the next
 * click on library content. Safe to call when settings is already closed.
 */
export async function closeSettings(page: Page) {
  // Detect the shell via data-testid, NOT a role query: while a nested dialog
  // (e.g. the Lexicon Manager) is open — or still animating closed — Radix
  // marks the shell aria-hidden, which hides it from role-based locators even
  // though it is fully on screen. A role probe here reports "already closed"
  // and skips the close entirely.
  const closeBtn = page.getByTestId('settings-close-button');
  // SettingsShell is a lazy route chunk: after a reload that lands on
  // /settings/* (the post-workspace-switch arm) the URL says "settings open"
  // well before the close button exists. An instant count() probe then reports
  // "already closed", skips the close, and the URL wait below has nothing to
  // wait for. When the URL says settings, give the shell a moment to mount.
  if (new URL(page.url()).pathname.includes('/settings')) {
    await closeBtn.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  }
  if (await closeBtn.count()) {
    // Retry loop: a force click dispatches at fixed coordinates, so one issued
    // while a closing nested dialog's backdrop is still up lands on that
    // backdrop instead of the close button and silently does nothing. The
    // shell unmounts on close, so a detached close button is the exit signal.
    await expect(async () => {
      if (await closeBtn.count()) {
        await closeBtn.click({ force: true, timeout: 2000 }).catch(() => {});
      }
      await expect(closeBtn).toHaveCount(0, { timeout: 2000 });
    }).toPass({ timeout: 20000 });
  }
  // Settings is the route-driven /settings/:tab overlay and close is a history
  // navigation — wait for the URL to actually leave /settings. A reload issued
  // while the URL still points at /settings/* re-opens the dialog on boot, and
  // its backdrop then swallows the next click (the WebKit-lane timeout mode).
  try {
    await page.waitForURL((url) => !url.pathname.includes('/settings'), { timeout: 10000 });
  } catch {
    // The shell never mounted (its chunk failed or is still loading — the
    // WebKit full-suite-load mode), so no close nav will ever happen. Navigate
    // to the underlay ourselves, mirroring SettingsShell's own close() target:
    // everything before the '/settings' marker (reader-nested mounts keep the
    // book route), or the library root.
    const { pathname } = new URL(page.url());
    const marker = pathname.indexOf('/settings');
    const underlay = marker > 0 ? pathname.slice(0, marker) : '/';
    await page.goto(underlay);
    await page.waitForURL((url) => !url.pathname.includes('/settings'), { timeout: 10000 });
  }
}

/**
 * Wait until the active reader engine reports ready. Replaces the removed
 * `window.rendition` global (Phase 6 caged epubjs behind the ReaderEngine port;
 * readiness now lives on window.__versicleTest.reader). Pass {locations:true} to
 * also wait for the locations index (epubjs book.locations.total() > 0).
 */
export async function waitForReaderReady(page: Page, opts: { locations?: boolean } = {}) {
  await page.waitForFunction(
    () => window.__versicleTest?.reader?.isReady?.() === true,
    null,
    { timeout: 30000 },
  );
  // isReady() only proves the engine OBJECT exists: EpubJsEngine constructs
  // with status 'ready', before the first display() has rendered anything.
  // Wait for a real location (set by the first relocation) so callers can
  // actually interact with rendered content — without this, a page-turn issued
  // against a still-blank rendition is silently dropped and the reader CFI
  // stays null forever (the WebKit-lane compass-rail timeout mode).
  await page.waitForFunction(
    () => (window.__versicleTest?.reader?.currentCfi?.() ?? null) !== null,
    null,
    { timeout: 30000 },
  );
  if (opts.locations) {
    await page
      .waitForFunction(
        () => (window.__versicleTest?.reader?.locationsTotal?.() ?? 0) > 0,
        null,
        { timeout: 30000 },
      )
      .catch(() => {});
  }
}
