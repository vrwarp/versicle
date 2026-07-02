export type ReferenceDetectionStrategy = 'gemini' | 'deterministic';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GenAILogEntry } from '@domains/google';
import type { ContentType } from '~types/content-analysis';
import type { QuotaLimits, LaneUsage } from '@kernel/quota';

/**
 * GenAI configuration + activity-log store (Phase 7 §H, privacy D3/GG-3).
 *
 * PERSISTENCE CONTRACT (PR-A5): `partialize` is an explicit ALLOWLIST —
 * settings only. `logs` is an in-memory ring buffer (`maxLogs`-capped) that
 * is NEVER persisted THROUGH THIS STORE: the pre-Phase-7 spread-partialize
 * wrote full prompts — book text and base64 table screenshots — to plaintext
 * localStorage unconditionally, with quadratic re-serialization on every
 * set() and latent QuotaExceededError corruption. Entries arrive PRE-REDACTED
 * from the GenAI client (inlineData → {byteCount, hash} — domains/google/
 * genai/logging.ts). persist version 1 strips `logs`/`usageStats` from
 * existing blobs on rehydrate (strip-only, tolerated by older code reading
 * the slimmer blob; localStorage-only — NOT synced user data, so the
 * program's one-in-flight format-change rule is not engaged).
 *
 * Cross-restart log persistence lives OUTSIDE this store: the app-layer
 * mirror (app/google/genaiLogPersistence.ts) writes each appended entry to a
 * small dedicated IndexedDB database and re-injects them at boot via
 * `hydrateLogs` — per-row IDB writes, none of the localStorage failure modes
 * above. The partialize allowlist here still excludes `logs`.
 *
 * `apiKey` stays in the allowlist deliberately (BYO-key product model);
 * secrets isolation is the privacy report's D11, out of Phase 7 scope.
 *
 * The store no longer configures any singleton: the GeminiClient reads
 * config PER CALL via the provider wired in src/app/google/wireGoogle.ts.
 *
 * Quota config: the plain-data quota fields (`quotaLimits`,
 * `bgThrottlePercent`, `fgRpdHeadroom`, `pauseAllGenAI`) ARE in the allowlist
 * — settings the user edits in the GenAI tab to cap request rate/spend.
 * `getQuotaSnapshot` is a live read-back of current usage: an IN-MEMORY
 * provider function injected at startup (wireGoogle installs
 * `() => governor.snapshot()`), so it is NEVER persisted — a function in
 * localStorage would serialize to garbage, the same exclusion as logs above.
 */
interface GenAIState {
  apiKey: string;
  model: string;
  /** Embedding model id, read per embed call by the client. */
  embeddingModel: string;
  /** Requested embedding output dimensionality (vector length). */
  embeddingDims: number;
  /**
   * When ON, the embedding client packs up to 100 texts into one
   * `:batchEmbedContents` call instead of N separate `:embedContent` calls.
   * Default OFF: it is not yet confirmed whether the batch endpoint counts as
   * one request against the daily quota or N, so batching could silently blow
   * the budget — it stays off until measured live. Additive field — tolerated
   * by older persisted blobs (no migration needed).
   */
  useBatchEmbedding: boolean;
  isEnabled: boolean;
  isModelRotationEnabled: boolean;
  isContentAnalysisEnabled: boolean;
  isTableAdaptationEnabled: boolean;
  contentFilterSkipTypes: ContentType[];
  isDebugModeEnabled: boolean;
  referenceDetectionStrategy: ReferenceDetectionStrategy;
  /** In-memory ring buffer (never persisted; pre-redacted entries). */
  logs: GenAILogEntry[];
  maxLogs: number;
  /** Persisted per-lane quota limits, read fresh on every budget reservation. */
  quotaLimits: QuotaLimits;
  /** Persisted per-pool quota limits map. */
  quotaLimitsMap: Record<string, QuotaLimits>;
  /** Persisted fraction (%) of the budget background work may consume. */
  bgThrottlePercent: number;
  /** Persisted RPD headroom reserved for the foreground lane. */
  fgRpdHeadroom: number;
  /** Persisted master pause — zeroes limits so acquire backpressures pre-network. */
  pauseAllGenAI: boolean;
  /**
   * Persisted, default-OFF library-wide opt-in for proactively embedding books.
   * When ON, the FULL TEXT of every book present on this device may be sent to
   * Google for embedding during idle time on the background (low-priority)
   * request lane, so semantic search is ready across the whole library (the
   * foreground indexer covers the currently open book). The single source
   * of truth read by both the consent check and the background backfill task.
   * Additive field — tolerated by older persisted blobs (no migration needed).
   */
  preEmbedLibrary: boolean;
  /**
   * Persisted, default-OFF "Share AI caches across my devices" opt-in.
   * Embeddings are expensive to regenerate (they cost API quota), so a book
   * embedded on one device should be reusable on the user's other devices. When
   * ON, this gates BOTH halves of that: uploading this device's book embeddings
   * into the user's OWN cloud storage, AND reading another device's uploaded
   * embeddings instead of recomputing. A localStorage flag like preEmbedLibrary
   * — no IndexedDB/CRDT change. Additive — tolerated by older persisted blobs
   * (no migration needed). (design: plan/shared-ai-cache-design.md)
   */
  shareAiCaches: boolean;
  /**
   * In-memory injected snapshot provider (the READ mirror of `addLog`):
   * wireGoogle installs `() => governor.snapshot()`. NEVER persisted.
   */
  getQuotaSnapshot?: (ratePool?: string) => Record<'fg' | 'bg', LaneUsage>;
  /**
   * In-memory injected seam exposing the background lane's budget: wireGoogle
   * installs the background-lane ceiling and the governor's live
   * background-requests-today count, so the background backfill task can check
   * whether it has room to embed more WITHOUT importing the kernel governor.
   * NEVER persisted (same reason as getQuotaSnapshot — a function serializes to
   * garbage).
   */
  getBgQuotaLimits?: () => QuotaLimits;
  getBgUsedRpd?: () => number;
  setApiKey: (key: string) => void;
  setModel: (model: string) => void;
  setEmbeddingModel: (model: string) => void;
  setEmbeddingDims: (dims: number) => void;
  setUseBatchEmbedding: (enabled: boolean) => void;
  setEnabled: (enabled: boolean) => void;
  setModelRotationEnabled: (enabled: boolean) => void;
  setContentAnalysisEnabled: (enabled: boolean) => void;
  setTableAdaptationEnabled: (enabled: boolean) => void;
  setContentFilterSkipTypes: (types: ContentType[]) => void;
  setDebugModeEnabled: (enabled: boolean) => void;
  setReferenceDetectionStrategy: (strategy: ReferenceDetectionStrategy) => void;
  setMaxLogs: (max: number) => void;
  addLog: (log: GenAILogEntry) => void;
  /**
   * Prepend entries restored from the cross-restart IDB mirror (app/google/
   * genaiLogPersistence.ts) — deduped by id against anything already logged
   * this session, capped at maxLogs.
   */
  hydrateLogs: (entries: GenAILogEntry[]) => void;
  clearLogs: () => void;
  setQuotaLimits: (limits: QuotaLimits) => void;
  setQuotaLimitsForPool: (ratePool: string, limits: QuotaLimits) => void;
  resetAllQuotaLimits: () => void;
  setBgThrottlePercent: (percent: number) => void;
  setFgRpdHeadroom: (headroom: number) => void;
  setPauseAllGenAI: (paused: boolean) => void;
  setPreEmbedLibrary: (enabled: boolean) => void;
  setShareAiCaches: (enabled: boolean) => void;
  setQuotaSnapshotProvider: (provider: (ratePool?: string) => Record<'fg' | 'bg', LaneUsage>) => void;
  /** Install the background-lane budget read-back seam (in-memory; never persisted). */
  setBgBudgetProvider: (getBgQuotaLimits: () => QuotaLimits, getBgUsedRpd: () => number) => void;
}

/** The persisted slice (explicit allowlist — see module header). */
type PersistedGenAIState = Pick<
  GenAIState,
  | 'apiKey'
  | 'model'
  | 'embeddingModel'
  | 'embeddingDims'
  | 'useBatchEmbedding'
  | 'isEnabled'
  | 'isModelRotationEnabled'
  | 'isContentAnalysisEnabled'
  | 'isTableAdaptationEnabled'
  | 'contentFilterSkipTypes'
  | 'isDebugModeEnabled'
  | 'referenceDetectionStrategy'
  | 'maxLogs'
  | 'quotaLimits'
  | 'quotaLimitsMap'
  | 'bgThrottlePercent'
  | 'fgRpdHeadroom'
  | 'pauseAllGenAI'
  | 'preEmbedLibrary'
  | 'shareAiCaches'
>;

export const DEFAULT_QUOTA_LIMITS: Record<string, QuotaLimits> = {
  default: { rpm: 100, tpm: 30_000, rpd: 1000 },
  'gemini-1.5-pro': { rpm: 2, tpm: 32_000, rpd: 50 },
  'google-tts': { rpm: 100, tpm: 30_000, rpd: 1000 },
  'openai-tts': { rpm: 100, tpm: 30_000, rpd: 1000 },
  'google-tts-chirp3-hd': { rpm: 100, tpm: 30_000, rpd: 500 },
  'google-tts-wavenet': { rpm: 100, tpm: 100_000, rpd: 2000 },
  'google-tts-studio': { rpm: 100, tpm: 30_000, rpd: 500 },
  'google-tts-standard': { rpm: 100, tpm: 100_000, rpd: 2000 },
  'google-tts-neural2': { rpm: 100, tpm: 30_000, rpd: 500 },
  'google-tts-polyglot': { rpm: 100, tpm: 30_000, rpd: 500 },
  'gemini-embedding-001': { rpm: 100, tpm: 30_000, rpd: 1000 },
  'gemini-2.5-flash': { rpm: 5, tpm: 250_000, rpd: 20 },
  'gemini-2.5-flash-lite': { rpm: 10, tpm: 250_000, rpd: 20 },
  'gemini-2.5-flash-tts': { rpm: 3, tpm: 10_000, rpd: 10 },
  'gemini-3-flash-preview': { rpm: 5, tpm: 250_000, rpd: 20 },
  'gemini-3.1-flash-lite': { rpm: 15, tpm: 250_000, rpd: 500 },
  'gemini-3.1-flash-tts': { rpm: 3, tpm: 10_000, rpd: 10 },
  'gemini-3.5-flash': { rpm: 5, tpm: 250_000, rpd: 20 },
  'gemini-embedding-2': { rpm: 100, tpm: 30_000, rpd: 1000 },
  'gemini-robotics-er-1.5-preview': { rpm: 10, tpm: 250_000, rpd: 20 },
  'gemini-robotics-er-1.6-preview': { rpm: 5, tpm: 250_000, rpd: 20 },
  'gemma-4-26b': { rpm: 15, tpm: 999_999_999, rpd: 1500 },
  'gemma-4-31b': { rpm: 15, tpm: 999_999_999, rpd: 1500 },
  'imagen-4-fast-generate': { rpm: 999_999, tpm: 999_999_999, rpd: 25 },
  'imagen-4-generate': { rpm: 999_999, tpm: 999_999_999, rpd: 25 },
  'imagen-4-ultra-generate': { rpm: 999_999, tpm: 999_999_999, rpd: 25 },
  'gemini-2.5-flash-native-audio-dialog': { rpm: 999_999, tpm: 1_000_000, rpd: 999_999 },
  'gemini-3-flash-live': { rpm: 999_999, tpm: 65_000, rpd: 999_999 },
  'gemini-3.5-live-translate': { rpm: 999_999, tpm: 20_000, rpd: 999_999 },
  'deep-research-pro-preview-map-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 500 },
  'gemini-2-flash-map-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 500 },
  'gemini-2.0-flash-map-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 500 },
  'computer-use-preview-map-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 500 },
  'gemini-2.5-flash-map-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 500 },
  'gemini-2.5-flash-lite-map-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 500 },
  'gemini-3.1-flash-lite-map-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 500 },
  'gemini-3.1-flash-tts-map-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 500 },
  'gemini-robotics-er-1.6-preview-map-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 500 },
  'gemini-2-search-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 1500 },
  'gemini-2.0-search-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 1500 },
  'gemini-2.5-search-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 1500 },
  'default-search-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 1500 },
};

export const useGenAIStore = create<GenAIState>()(
  persist(
    (set) => ({
      apiKey: '',
      model: 'gemini-flash-lite-latest',
      embeddingModel: 'gemini-embedding-2',
      embeddingDims: 768,
      useBatchEmbedding: false,
      isEnabled: false,
      isModelRotationEnabled: false,
      isContentAnalysisEnabled: false,
      isTableAdaptationEnabled: false,
      contentFilterSkipTypes: ['reference'],
      isDebugModeEnabled: false,
      referenceDetectionStrategy: 'gemini' as ReferenceDetectionStrategy,
      logs: [],
      maxLogs: 500,
      quotaLimits: { rpm: 100, tpm: 30_000, rpd: 1000 },
      quotaLimitsMap: DEFAULT_QUOTA_LIMITS,
      bgThrottlePercent: 50,
      fgRpdHeadroom: 0,
      pauseAllGenAI: false,
      preEmbedLibrary: false,
      shareAiCaches: false,
      getQuotaSnapshot: undefined,
      getBgQuotaLimits: undefined,
      getBgUsedRpd: undefined,
      setApiKey: (key) => set({ apiKey: key }),
      setModel: (model) => set({ model }),
      setEmbeddingModel: (model) => set({ embeddingModel: model }),
      setEmbeddingDims: (dims) => set({ embeddingDims: dims }),
      setUseBatchEmbedding: (enabled) => set({ useBatchEmbedding: enabled }),
      setEnabled: (enabled) => set({ isEnabled: enabled }),
      setModelRotationEnabled: (enabled) => set({ isModelRotationEnabled: enabled }),
      setContentAnalysisEnabled: (enabled) => set({ isContentAnalysisEnabled: enabled }),
      setTableAdaptationEnabled: (enabled) => set({ isTableAdaptationEnabled: enabled }),
      setContentFilterSkipTypes: (types) => set({ contentFilterSkipTypes: types }),
      setDebugModeEnabled: (enabled) => set({ isDebugModeEnabled: enabled }),
      setReferenceDetectionStrategy: (strategy) =>
        set({ referenceDetectionStrategy: strategy }),
      setMaxLogs: (max) => set({ maxLogs: max }),
      addLog: (log) =>
        set((state) => {
          const newLogs = [...state.logs, log];
          if (newLogs.length > state.maxLogs) {
            newLogs.splice(0, newLogs.length - state.maxLogs);
          }
          return { logs: newLogs };
        }),
      hydrateLogs: (entries) =>
        set((state) => {
          const existing = new Set(state.logs.map((l) => l.id));
          const restored = entries.filter((e) => !existing.has(e.id));
          if (restored.length === 0) return {};
          const merged = [...restored, ...state.logs];
          if (merged.length > state.maxLogs) {
            merged.splice(0, merged.length - state.maxLogs);
          }
          return { logs: merged };
        }),
      clearLogs: () => set({ logs: [] }),
      setQuotaLimits: (limits) =>
        set((state) => ({
          quotaLimits: limits,
          quotaLimitsMap: { ...state.quotaLimitsMap, default: limits },
        })),
      setQuotaLimitsForPool: (ratePool, limits) =>
        set((state) => ({
          quotaLimitsMap: { ...state.quotaLimitsMap, [ratePool]: limits },
          ...(ratePool === 'default' ? { quotaLimits: limits } : {}),
        })),
      resetAllQuotaLimits: () =>
        set({
          quotaLimits: DEFAULT_QUOTA_LIMITS.default,
          quotaLimitsMap: DEFAULT_QUOTA_LIMITS,
        }),
      setBgThrottlePercent: (percent) => set({ bgThrottlePercent: percent }),
      setFgRpdHeadroom: (headroom) => set({ fgRpdHeadroom: headroom }),
      setPauseAllGenAI: (paused) => set({ pauseAllGenAI: paused }),
      setPreEmbedLibrary: (enabled) => set({ preEmbedLibrary: enabled }),
      setShareAiCaches: (enabled) => set({ shareAiCaches: enabled }),
      setQuotaSnapshotProvider: (provider) => set({ getQuotaSnapshot: provider }),
      setBgBudgetProvider: (getBgQuotaLimits, getBgUsedRpd) =>
        set({ getBgQuotaLimits, getBgUsedRpd }),
    }),
    {
      name: 'genai-storage',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedGenAIState => ({
        apiKey: state.apiKey,
        model: state.model,
        embeddingModel: state.embeddingModel,
        embeddingDims: state.embeddingDims,
        useBatchEmbedding: state.useBatchEmbedding,
        isEnabled: state.isEnabled,
        isModelRotationEnabled: state.isModelRotationEnabled,
        isContentAnalysisEnabled: state.isContentAnalysisEnabled,
        isTableAdaptationEnabled: state.isTableAdaptationEnabled,
        contentFilterSkipTypes: state.contentFilterSkipTypes,
        isDebugModeEnabled: state.isDebugModeEnabled,
        referenceDetectionStrategy: state.referenceDetectionStrategy,
        maxLogs: state.maxLogs,
        quotaLimits: state.quotaLimits,
        quotaLimitsMap: state.quotaLimitsMap,
        bgThrottlePercent: state.bgThrottlePercent,
        fgRpdHeadroom: state.fgRpdHeadroom,
        pauseAllGenAI: state.pauseAllGenAI,
        preEmbedLibrary: state.preEmbedLibrary,
        shareAiCaches: state.shareAiCaches,
      }),
      /**
       * v0 → v1: strip the legacy persisted `logs` (full prompts, base64
       * table images) and dead `usageStats` from existing blobs. Settings
       * (apiKey/model/flags) survive untouched — pinned by the captured-
       * blob regression test (useGenAIStore.migration.test.ts).
       *
       * v1 → v2: switch the embedding model off the retired `gemini-embedding-001`
       * onto `gemini-embedding-2` (the GA model — 8192-token inputs vs 2048,
       * prompt-instruction profiles instead of `taskType`, auto-normalized
       * truncated dims). Only the OLD default is flipped, so a hand-picked model
       * is left alone. The two embedding spaces are incompatible, so the prior
       * `-001` vectors are ABANDONED automatically: the stamp guards re-embed the
       * book on the next index pass and skip the stale vectors (regex-only) until
       * then — no purge needed (see EmbeddingIndexer / semanticRank stamp checks).
       *
       * v2 → v3: seed default limits for newly supported Google TTS pools
       * (chirp3-hd, wavenet, studio, standard, neural2, polyglot) so that
       * they can be configured individually.
       */
      migrate: (persistedState, version) => {
        if (persistedState && typeof persistedState === 'object') {
          const state = persistedState as Record<string, unknown>;
          if (version < 1) {
            delete state.logs;
            delete state.usageStats;
          }
          if (version < 2 && state.embeddingModel === 'gemini-embedding-001') {
            state.embeddingModel = 'gemini-embedding-2';
          }
        }
        if (version < 2 && persistedState && typeof persistedState === 'object') {
          const state = persistedState as Record<string, unknown>;
          const defaultLimits = (state.quotaLimits as QuotaLimits | undefined) || { rpm: 100, tpm: 30_000, rpd: 1000 };
          state.quotaLimitsMap = {
            default: defaultLimits,
            'gemini-1.5-pro': { rpm: 2, tpm: 32_000, rpd: 50 },
            'google-tts': { rpm: 100, tpm: 30_000, rpd: 1000 },
            'openai-tts': { rpm: 100, tpm: 30_000, rpd: 1000 },
            'gemini-embedding-001': { rpm: 100, tpm: 30_000, rpd: 1000 },
            'gemini-2.5-flash': { rpm: 5, tpm: 250_000, rpd: 20 },
            'gemini-2.5-flash-lite': { rpm: 10, tpm: 250_000, rpd: 20 },
            'gemini-2.5-flash-tts': { rpm: 3, tpm: 10_000, rpd: 10 },
            'gemini-3-flash-preview': { rpm: 5, tpm: 250_000, rpd: 20 },
            'gemini-3.1-flash-lite': { rpm: 15, tpm: 250_000, rpd: 500 },
            'gemini-3.1-flash-tts': { rpm: 3, tpm: 10_000, rpd: 10 },
            'gemini-3.5-flash': { rpm: 5, tpm: 250_000, rpd: 20 },
            'gemini-embedding-2': { rpm: 100, tpm: 30_000, rpd: 1000 },
            'gemini-robotics-er-1.5-preview': { rpm: 10, tpm: 250_000, rpd: 20 },
            'gemini-robotics-er-1.6-preview': { rpm: 5, tpm: 250_000, rpd: 20 },
            'gemma-4-26b': { rpm: 15, tpm: 999_999_999, rpd: 1500 },
            'gemma-4-31b': { rpm: 15, tpm: 999_999_999, rpd: 1500 },
            'imagen-4-fast-generate': { rpm: 999_999, tpm: 999_999_999, rpd: 25 },
            'imagen-4-generate': { rpm: 999_999, tpm: 999_999_999, rpd: 25 },
            'imagen-4-ultra-generate': { rpm: 999_999, tpm: 999_999_999, rpd: 25 },
            'gemini-2.5-flash-native-audio-dialog': { rpm: 999_999, tpm: 1_000_000, rpd: 999_999 },
            'gemini-3-flash-live': { rpm: 999_999, tpm: 65_000, rpd: 999_999 },
            'gemini-3.5-live-translate': { rpm: 999_999, tpm: 20_000, rpd: 999_999 },
            'deep-research-pro-preview-map-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 500 },
            'gemini-2-flash-map-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 500 },
            'gemini-2.0-flash-map-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 500 },
            'computer-use-preview-map-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 500 },
            'gemini-2.5-flash-map-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 500 },
            'gemini-2.5-flash-lite-map-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 500 },
            'gemini-3.1-flash-lite-map-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 500 },
            'gemini-3.1-flash-tts-map-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 500 },
            'gemini-robotics-er-1.6-preview-map-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 500 },
            'gemini-2-search-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 1500 },
            'gemini-2.0-search-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 1500 },
            'gemini-2.5-search-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 1500 },
            'default-search-grounding': { rpm: 999_999, tpm: 999_999_999, rpd: 1500 },
          };
          state.quotaLimits = defaultLimits;
        }
        if (version < 3 && persistedState && typeof persistedState === 'object') {
          const state = persistedState as Record<string, unknown>;
          const map = (state.quotaLimitsMap as Record<string, QuotaLimits> | undefined) || {};
          state.quotaLimitsMap = {
            ...map,
            'google-tts-chirp3-hd': { rpm: 100, tpm: 30_000, rpd: 500 },
            'google-tts-wavenet': { rpm: 100, tpm: 100_000, rpd: 2000 },
            'google-tts-studio': { rpm: 100, tpm: 30_000, rpd: 500 },
            'google-tts-standard': { rpm: 100, tpm: 100_000, rpd: 2000 },
            'google-tts-neural2': { rpm: 100, tpm: 30_000, rpd: 500 },
            'google-tts-polyglot': { rpm: 100, tpm: 30_000, rpd: 500 },
          };
        }
        return persistedState as PersistedGenAIState;
      },
    },
  ),
);
