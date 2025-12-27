import { describe, it, expect, beforeEach } from 'vitest';
import { useGenAIStore } from './useGenAIStore';

describe('useGenAIStore', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useGenAIStore.getState().init();
    useGenAIStore.setState({
        apiKey: '',
        model: 'gemini-2.5-flash-lite',
        isEnabled: false,
        logs: [],
        usageStats: { totalTokens: 0, estimatedCost: 0 }
    });
  });

  it('should persist apiKey and logs to localStorage (user requirement)', () => {
    const sensitiveKey = 'secret-api-key-123';
    const logEntry = {
        id: '1',
        timestamp: 123,
        type: 'request' as const,
        method: 'test',
        payload: { prompt: 'secret prompt' }
    };

    useGenAIStore.getState().setApiKey(sensitiveKey);
    useGenAIStore.getState().addLog(logEntry);
    useGenAIStore.getState().setEnabled(true);

    // Force rehydration (simulate reload)
    // Zustand persist middleware writes to localStorage synchronously by default
    const storedString = localStorage.getItem('genai-storage');
    expect(storedString).toBeTruthy();

    const stored = JSON.parse(storedString!);
    const state = stored.state;

    // These SHOULD be persisted in localStorage now
    expect(state.apiKey).toBe(sensitiveKey);
    expect(state.logs).toHaveLength(1);
    expect(state.isEnabled).toBe(true);
  });
});
