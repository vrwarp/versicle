/**
 * The typed E2E test API: `window.__versicleTest`.
 *
 * One module owns the page-side seams the Playwright suite needs, instead of
 * scattering untyped `window.__*` globals through production code. Installed
 * ONLY from main.tsx behind `import.meta.env.DEV || VITE_E2E` (the
 * verification Docker build sets VITE_E2E=true); production builds never
 * execute this module.
 *
 * Lives at the src/ root next to main.tsx (its only importer): this is
 * composition-root wiring, not a lib/ service — and lib/ may not depend on
 * store/ (.dependency-cruiser.cjs `lib-not-to-store`). Its final home is
 * `app/` (master plan §2 rule 9, §5 P1b).
 *
 * The legacy function globals are consolidated here (Phase 1b):
 * `__DISCONNECT_YJS__` → `disconnectYjs()`, `__CLOSE_DB__` → `closeDb()`.
 * The `__VERSICLE_MOCK_*` flags stay as raw window globals — they are INPUT
 * injected by Playwright `addInitScript()` before the app boots, so they
 * cannot live behind installTestApi(); their typed readers are in
 * src/test-flags.ts.
 */
import type { IndexeddbPersistence } from 'y-idb';
import { getYjsPersistence, disconnectYjs } from './store/yjs-provider';
import { playbackCache } from './data/repos/playbackCache';
import { closeConnection } from './data/connection';
import { wipeAllData } from './data/wipe';
import { MockGenAIClient, setGenAIClient, type MockGenAIFixture } from './domains/google';
import { useContentAnalysisStore } from './store/useContentAnalysisStore';
import { useGenAIStore } from './store/useGenAIStore';
import { getActiveReaderEngine } from './domains/reader/engine/activeEngineRegistry';
import { getTtsController } from './app/tts/TtsController';
import type { HighlightLayerId } from './domains/reader/engine/highlightStyles';
import { createLogger } from './lib/logger';

const logger = createLogger('TestApi');

export interface VersicleTestApi {
  /**
   * Deterministically flush every debounced persistence queue:
   *  - playbackCache `cache_session_state` writes (500ms debounce — the TTS
   *    playback queue / lastPauseTime mirror), and
   *  - the y-idb Yjs update queue (`writeDebounceMs: 200` — reading
   *    progress, annotations, the whole CRDT).
   *
   * Resolves once both queues are quiescent (all bytes handed to committed
   * IndexedDB transactions), so a `page.reload()` immediately afterwards
   * cannot lose state. Replaces the E2E suite's hardcoded 1500ms
   * `waitForPersistedWrites` sleep.
   */
  flushPersistence(): Promise<void>;

  /**
   * Full local data reset (both IndexedDB databases, Versicle-owned
   * localStorage keys, app caches) WITHOUT the page reload — the caller
   * (Playwright) controls navigation. Delegates to `wipeAllData`, the single
   * owner of "what counts as all local data".
   */
  resetApp(): Promise<void>;

  /**
   * Destroy the y-idb persistence binding so the `versicle-yjs` database
   * releases its IndexedDB locks (specs delete databases between scenarios).
   * Replaces the legacy `window.__DISCONNECT_YJS__` global.
   */
  disconnectYjs(): Promise<void>;

  /**
   * Close the `EpubLibraryDB` connection so it releases its IndexedDB locks.
   * Replaces the legacy `window.__CLOSE_DB__` global.
   */
  closeDb(): Promise<void>;

  /**
   * GenAI mock seam (Phase 7 §H — the `localStorage.mockGenAIResponse` exit,
   * GG-4/privacy D9): swaps the composition-root GenAIClient for a
   * MockGenAIClient primed with the fixture. Runtime-settable, so specs
   * install it after boot/reload (the legacy localStorage timing maps 1:1).
   * `{ response }` resolves every structured call with the fixture (run
   * through the SAME per-feature validation as real model output);
   * `{ error }` rejects every call with that message.
   */
  genai: {
    setMock(fixture: MockGenAIFixture): void;
    /**
     * Toggles the GenAI content-analysis debug mode (the same switch the
     * settings UI drives via useGenAIStore.setDebugModeEnabled). P6 overlay
     * characterization seam: the debug-highlight layer keys on this flag.
     */
    setDebugMode(enabled: boolean): void;
  };

  /**
   * Seeds a content-analysis result for one section (P6 entry gate,
   * prep/phase6-reader-engine.md §Test plan): writes through the
   * useContentAnalysisStore action so the reader's debug-highlight layer
   * picks it up exactly like real GenAI output.
   */
  seedContentAnalysis(
    bookId: string,
    sectionId: string,
    payload: { referenceStartCfi: string },
  ): void;

  /**
   * TTS playback commands for the verification specs (Phase 9): the typed
   * replacement for the play/pause half of the legacy `window.useTTSStore`
   * shim (deleted from main.tsx at its named P9 deadline). State READS go
   * through `window.useTTSPlaybackStore` — the real store, exposed for
   * verification — so this surface carries only the commands, routed
   * through the same TtsController the UI uses.
   */
  tts: {
    play(): void;
    pause(): void;
  };

  /**
   * Typed reader predicates over the live ReaderEngine (Phase 6 §2b) —
   * the named replacements for the exact `window.rendition` /
   * `__reader_added_annotations_count` polls the E2E suite used to do.
   * All methods are safe before a reader mounts (null/0/false).
   */
  reader: {
    isReady(): boolean;
    currentCfi(): string | null;
    currentHref(): string | null;
    locationsTotal(): number;
    hasManager(): boolean;
    highlightCount(layer: HighlightLayerId): number;
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

/** Upper bound for a flush; a hung IDB transaction must fail the test loudly. */
const FLUSH_DEADLINE_MS = 10_000;

/**
 * Drain the y-idb persistence queue via the vendored fork's first-class
 * `flush()` (packages/y-idb/PROVENANCE.md surgery 1): it bypasses the 200ms
 * write debounce, awaits the in-flight transaction commit, and loops until
 * quiescent — including updates that arrive mid-flush. The deadline race
 * keeps a hung IDB transaction failing the test loudly instead of stalling
 * the suite (flush() itself retries forever, mirroring the internal
 * machinery).
 */
async function flushYjsPersistence(): Promise<void> {
  const persistence: IndexeddbPersistence | null = getYjsPersistence();
  if (!persistence || persistence._destroyed) return;

  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(() => {
      reject(
        new Error(
          `[test-api] flushPersistence: y-idb queue did not drain within ${FLUSH_DEADLINE_MS}ms ` +
            `(pending=${persistence._pendingUpdates.length}, writing=${persistence._writing})`,
        ),
      );
    }, FLUSH_DEADLINE_MS);
  });
  try {
    await Promise.race([persistence.flush(), deadline]);
  } finally {
    clearTimeout(deadlineTimer);
  }
}

export async function flushPersistence(): Promise<void> {
  // Both writers funnel through the shared exclusive IDB write gate
  // (src/data/write-gate.ts), so flushing them sequentially is also the
  // ordering the app itself guarantees.
  await playbackCache.flushPending();
  await flushYjsPersistence();
}

export function installTestApi(): void {
  if (typeof window === 'undefined') return;
  const api: VersicleTestApi = {
    flushPersistence,
    resetApp: () => wipeAllData({ reload: false }),
    disconnectYjs: () => disconnectYjs(),
    closeDb: () => closeConnection(),
    genai: {
      setMock: (fixture) => {
        setGenAIClient(new MockGenAIClient(fixture));
        logger.info('GenAI mock client installed', fixture.error ? '(error mode)' : '');
      },
      setDebugMode: (enabled) => {
        useGenAIStore.getState().setDebugModeEnabled(enabled);
        logger.info(`GenAI debug mode ${enabled ? 'enabled' : 'disabled'} (test API)`);
      },
    },
    tts: {
      play: () => getTtsController().play(),
      pause: () => getTtsController().pause(),
    },
    seedContentAnalysis: (bookId, sectionId, payload) => {
      useContentAnalysisStore
        .getState()
        .saveReferenceStartCfi(bookId, sectionId, payload.referenceStartCfi);
      logger.info(`Seeded content analysis for ${bookId}/${sectionId} (test API)`);
    },
    reader: {
      isReady: () => getActiveReaderEngine()?.status === 'ready',
      currentCfi: () => getActiveReaderEngine()?.currentLocation()?.startCfi ?? null,
      currentHref: () => getActiveReaderEngine()?.currentLocation()?.sectionHref ?? null,
      locationsTotal: () => getActiveReaderEngine()?.locations.length() ?? 0,
      hasManager: () => getActiveReaderEngine()?.getOverlayContainer() != null,
      highlightCount: (layer) => getActiveReaderEngine()?.highlights.count(layer) ?? 0,
      next: () => getActiveReaderEngine()?.next() ?? Promise.resolve(),
      prev: () => getActiveReaderEngine()?.prev() ?? Promise.resolve(),
      display: (target) => getActiveReaderEngine()?.display(target) ?? Promise.resolve(),
    },
  };
  window.__versicleTest = api;
  logger.info('window.__versicleTest installed (DEV/VITE_E2E build)');
}
