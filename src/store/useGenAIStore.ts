export type ReferenceDetectionStrategy = 'gemini' | 'deterministic';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GenAILogEntry } from '@domains/google';
import type { ContentType } from '~types/content-analysis';

/**
 * GenAI configuration + activity-log store (Phase 7 §H, privacy D3/GG-3).
 *
 * PERSISTENCE CONTRACT (PR-A5): `partialize` is an explicit ALLOWLIST —
 * settings only. `logs` is an IN-MEMORY ring buffer (`maxLogs`-capped) and
 * is NEVER persisted: the pre-Phase-7 spread-partialize wrote full prompts
 * — book text and base64 table screenshots — to plaintext localStorage
 * unconditionally, with quadratic re-serialization on every set() and
 * latent QuotaExceededError corruption. Entries arrive PRE-REDACTED from
 * the GenAI client (inlineData → {byteCount, hash} — domains/google/genai/
 * logging.ts). persist version 1 strips `logs`/`usageStats` from existing
 * blobs on rehydrate (strip-only, tolerated by older code reading the
 * slimmer blob; localStorage-only — NOT synced user data, so the program's
 * one-in-flight format-change rule is not engaged).
 *
 * `apiKey` stays in the allowlist deliberately (BYO-key product model);
 * secrets isolation is the privacy report's D11, out of Phase 7 scope.
 *
 * The store no longer configures any singleton: the GeminiClient reads
 * config PER CALL via the provider wired in src/app/google/wireGoogle.ts.
 */
interface GenAIState {
  apiKey: string;
  model: string;
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
  setApiKey: (key: string) => void;
  setModel: (model: string) => void;
  setEnabled: (enabled: boolean) => void;
  setModelRotationEnabled: (enabled: boolean) => void;
  setContentAnalysisEnabled: (enabled: boolean) => void;
  setTableAdaptationEnabled: (enabled: boolean) => void;
  setContentFilterSkipTypes: (types: ContentType[]) => void;
  setDebugModeEnabled: (enabled: boolean) => void;
  setReferenceDetectionStrategy: (strategy: ReferenceDetectionStrategy) => void;
  setMaxLogs: (max: number) => void;
  addLog: (log: GenAILogEntry) => void;
  clearLogs: () => void;
}

/** The persisted slice (explicit allowlist — see module header). */
type PersistedGenAIState = Pick<
  GenAIState,
  | 'apiKey'
  | 'model'
  | 'isEnabled'
  | 'isModelRotationEnabled'
  | 'isContentAnalysisEnabled'
  | 'isTableAdaptationEnabled'
  | 'contentFilterSkipTypes'
  | 'isDebugModeEnabled'
  | 'referenceDetectionStrategy'
  | 'maxLogs'
>;

export const useGenAIStore = create<GenAIState>()(
  persist(
    (set) => ({
      apiKey: '',
      model: 'gemini-flash-lite-latest',
      isEnabled: false,
      isModelRotationEnabled: false,
      isContentAnalysisEnabled: false,
      isTableAdaptationEnabled: false,
      contentFilterSkipTypes: ['reference'],
      isDebugModeEnabled: false,
      referenceDetectionStrategy: 'gemini' as ReferenceDetectionStrategy,
      logs: [],
      maxLogs: 500,
      setApiKey: (key) => set({ apiKey: key }),
      setModel: (model) => set({ model }),
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
      clearLogs: () => set({ logs: [] }),
    }),
    {
      name: 'genai-storage',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedGenAIState => ({
        apiKey: state.apiKey,
        model: state.model,
        isEnabled: state.isEnabled,
        isModelRotationEnabled: state.isModelRotationEnabled,
        isContentAnalysisEnabled: state.isContentAnalysisEnabled,
        isTableAdaptationEnabled: state.isTableAdaptationEnabled,
        contentFilterSkipTypes: state.contentFilterSkipTypes,
        isDebugModeEnabled: state.isDebugModeEnabled,
        referenceDetectionStrategy: state.referenceDetectionStrategy,
        maxLogs: state.maxLogs,
      }),
      /**
       * v0 → v1: strip the legacy persisted `logs` (full prompts, base64
       * table images) and dead `usageStats` from existing blobs. Settings
       * (apiKey/model/flags) survive untouched — pinned by the captured-
       * blob regression test (useGenAIStore.migration.test.ts).
       */
      migrate: (persistedState, version) => {
        if (version < 1 && persistedState && typeof persistedState === 'object') {
          const state = persistedState as Record<string, unknown>;
          delete state.logs;
          delete state.usageStats;
        }
        return persistedState as PersistedGenAIState;
      },
    },
  ),
);
