import { describe, it, expect, beforeEach } from 'vitest';
import { useReaderStore } from './useReaderStore';

describe('useReaderStore', () => {
  beforeEach(() => {
    // Reset store state
    useReaderStore.setState({
      currentBookId: null,
      isLoading: false,
    });
  });

  it('should have initial state', () => {
    const state = useReaderStore.getState();
    expect(state.currentBookId).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  it('should set current book id', () => {
    useReaderStore.getState().setCurrentBookId('book-123');
    expect(useReaderStore.getState().currentBookId).toBe('book-123');
  });

  it('should clear current book id', () => {
    useReaderStore.getState().setCurrentBookId('book-123');
    useReaderStore.getState().setCurrentBookId(null);
    expect(useReaderStore.getState().currentBookId).toBeNull();
  });
});
