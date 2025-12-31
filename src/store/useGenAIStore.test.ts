import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGenAIStore } from './useGenAIStore';

describe('useGenAIStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useGenAIStore.setState({
      apiKey: '',
      model: 'gemini-2.5-flash-lite',
      isEnabled: false,
      contentFilteringEnabled: false,
      logs: [],
    });
  });

  it('should have contentFilteringEnabled default to false', () => {
    const state = useGenAIStore.getState();
    expect(state.contentFilteringEnabled).toBe(false);
  });

  it('should update contentFilteringEnabled', () => {
    useGenAIStore.getState().setContentFilteringEnabled(true);
    expect(useGenAIStore.getState().contentFilteringEnabled).toBe(true);

    useGenAIStore.getState().setContentFilteringEnabled(false);
    expect(useGenAIStore.getState().contentFilteringEnabled).toBe(false);
  });
});
