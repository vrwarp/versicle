import { describe, it, expect, beforeEach } from 'vitest';
import { useToastStore } from './useToastStore';

describe('useToastStore', () => {
  beforeEach(() => {
    // Reset store
    useToastStore.setState({ isVisible: false, message: '', type: 'info', duration: 3000 });
  });

  it('should have initial state', () => {
    const state = useToastStore.getState();
    expect(state.isVisible).toBe(false);
    expect(state.message).toBe('');
    expect(state.type).toBe('info');
  });

  it('should show toast', () => {
    useToastStore.getState().showToast('Test Message', 'success', 5000);
    const state = useToastStore.getState();
    expect(state.isVisible).toBe(true);
    expect(state.message).toBe('Test Message');
    expect(state.type).toBe('success');
    expect(state.duration).toBe(5000);
  });

  it('should hide toast', () => {
    useToastStore.getState().showToast('Test', 'error');
    useToastStore.getState().hideToast();
    const state = useToastStore.getState();
    expect(state.isVisible).toBe(false);
  });
});
