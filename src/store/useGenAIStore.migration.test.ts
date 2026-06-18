/**
 * genai-storage persist-migration suite (Phase 7 §H, PR-A5) — the
 * captured-artifact-fixture standard (master plan §3): a REAL pre-Phase-7
 * v0 blob (spread-partialize era: settings + persisted `logs` carrying full
 * prompts and base64 inlineData + dead `usageStats`) must rehydrate with
 * every setting intact and the logs STRIPPED.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Captured shape of `localStorage['genai-storage']` at the pre-Phase-7 HEAD
 * (partialize spread the whole state; useGenAIStore.ts:105-107 then).
 * Trimmed to two representative log entries — one with base64 inlineData
 * (the table-adaptation payload class that blew the localStorage quota).
 */
const CAPTURED_V0_BLOB = {
  state: {
    apiKey: 'user-api-key-123',
    model: 'gemini-2.5-flash',
    isEnabled: true,
    isModelRotationEnabled: true,
    isContentAnalysisEnabled: true,
    isTableAdaptationEnabled: false,
    contentFilterSkipTypes: ['reference'],
    isDebugModeEnabled: true,
    referenceDetectionStrategy: 'deterministic',
    maxLogs: 250,
    usageStats: { totalTokens: 1234, estimatedCost: 0 },
    logs: [
      {
        id: 'log-1',
        timestamp: 1718000000000,
        type: 'request',
        method: 'generateStructured',
        payload: { prompt: 'Full book text sample that must never persist…' },
      },
      {
        id: 'log-2',
        timestamp: 1718000001000,
        type: 'request',
        method: 'generateTableAdaptations',
        payload: {
          prompt: {
            contents: [
              {
                role: 'user',
                parts: [{ inlineData: { data: 'QkFTRTY0VEFCTEVJTUFHRQ==', mimeType: 'image/png' } }],
              },
            ],
          },
        },
      },
    ],
  },
  version: 0,
};

async function loadFreshStore() {
  vi.resetModules();
  const module = await import('./useGenAIStore');
  return module.useGenAIStore;
}

describe('genai-storage v0→v1 migration (captured-blob regression)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('settings (apiKey, model, flags, strategy, maxLogs) survive the strip migration', async () => {
    localStorage.setItem('genai-storage', JSON.stringify(CAPTURED_V0_BLOB));
    const useGenAIStore = await loadFreshStore();
    const state = useGenAIStore.getState();
    expect(state.apiKey).toBe('user-api-key-123');
    expect(state.model).toBe('gemini-2.5-flash');
    expect(state.isEnabled).toBe(true);
    expect(state.isModelRotationEnabled).toBe(true);
    expect(state.isContentAnalysisEnabled).toBe(true);
    expect(state.isTableAdaptationEnabled).toBe(false);
    expect(state.contentFilterSkipTypes).toEqual(['reference']);
    expect(state.isDebugModeEnabled).toBe(true);
    expect(state.referenceDetectionStrategy).toBe('deterministic');
    expect(state.maxLogs).toBe(250);
  });

  it('legacy persisted logs are stripped from state (in-memory buffer starts empty)', async () => {
    localStorage.setItem('genai-storage', JSON.stringify(CAPTURED_V0_BLOB));
    const useGenAIStore = await loadFreshStore();
    expect(useGenAIStore.getState().logs).toEqual([]);
  });

  it('the rewritten blob never contains logs, inlineData, or usageStats again', async () => {
    localStorage.setItem('genai-storage', JSON.stringify(CAPTURED_V0_BLOB));
    const useGenAIStore = await loadFreshStore();
    // Trigger a persist write.
    useGenAIStore.getState().setEnabled(true);
    const raw = localStorage.getItem('genai-storage')!;
    expect(raw).not.toContain('QkFTRTY0VEFCTEVJTUFHRQ==');
    expect(raw).not.toContain('"logs"');
    expect(raw).not.toContain('usageStats');
    expect(raw).not.toContain('Full book text sample');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(2);
    expect(parsed.state.apiKey).toBe('user-api-key-123');
  });

  it('addLog keeps entries in memory only — a persist write never includes them', async () => {
    const useGenAIStore = await loadFreshStore();
    useGenAIStore.getState().addLog({
      id: 'mem-1',
      timestamp: Date.now(),
      type: 'request',
      method: 'detectContentTypes',
      payload: { prompt: 'in-memory only' },
    });
    // Force a persisted write of the settings slice.
    useGenAIStore.getState().setModel('gemini-2.5-flash-lite');
    expect(useGenAIStore.getState().logs).toHaveLength(1);
    expect(localStorage.getItem('genai-storage')).not.toContain('in-memory only');
  });

  it('the ring buffer is capped at maxLogs', async () => {
    const useGenAIStore = await loadFreshStore();
    useGenAIStore.getState().setMaxLogs(3);
    for (let i = 0; i < 5; i++) {
      useGenAIStore.getState().addLog({
        id: `l-${i}`,
        timestamp: i,
        type: 'request',
        method: 'm',
        payload: {},
      });
    }
    expect(useGenAIStore.getState().logs.map((l) => l.id)).toEqual(['l-2', 'l-3', 'l-4']);
  });

  it('v1→v2 switches a persisted gemini-embedding-001 setting onto gemini-embedding-2', async () => {
    localStorage.setItem(
      'genai-storage',
      JSON.stringify({
        state: { apiKey: 'k', model: 'gemini-flash-lite-latest', embeddingModel: 'gemini-embedding-001' },
        version: 1,
      }),
    );
    const useGenAIStore = await loadFreshStore();
    expect(useGenAIStore.getState().embeddingModel).toBe('gemini-embedding-2');
    // The rewritten blob is at v2 and carries the switched model.
    useGenAIStore.getState().setEnabled(true);
    const parsed = JSON.parse(localStorage.getItem('genai-storage')!);
    expect(parsed.version).toBe(2);
    expect(parsed.state.embeddingModel).toBe('gemini-embedding-2');
  });

  it('v1→v2 leaves a hand-picked embedding model untouched', async () => {
    localStorage.setItem(
      'genai-storage',
      JSON.stringify({
        state: { apiKey: 'k', model: 'gemini-flash-lite-latest', embeddingModel: 'gemini-embedding-2' },
        version: 1,
      }),
    );
    const useGenAIStore = await loadFreshStore();
    expect(useGenAIStore.getState().embeddingModel).toBe('gemini-embedding-2');
  });

  it('the E2E seeding shape ({state, version: 0} with partial settings) rehydrates cleanly', async () => {
    // The smart-toc journey writes exactly this (verification spec).
    localStorage.setItem(
      'genai-storage',
      JSON.stringify({
        state: { isEnabled: true, apiKey: 'mock-key', model: 'gemini-flash-lite-latest' },
        version: 0,
      }),
    );
    const useGenAIStore = await loadFreshStore();
    expect(useGenAIStore.getState().isEnabled).toBe(true);
    expect(useGenAIStore.getState().apiKey).toBe('mock-key');
    // Defaults fill the unspecified keys.
    expect(useGenAIStore.getState().maxLogs).toBe(500);
  });
});
