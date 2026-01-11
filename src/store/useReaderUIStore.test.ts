import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useReaderUIStore } from './useReaderUIStore';

// Mock SyncOrchestrator to avoid issues with get()
vi.mock('../lib/sync/SyncOrchestrator', () => ({
    SyncOrchestrator: {
        get: vi.fn().mockReturnValue(null)
    }
}));

describe('useReaderUIStore', () => {
  beforeEach(() => {
    // Reset store state before each test using the store's own reset action
    // We avoid setState(..., true) because it overwrites actions defined in the store creator
    const state = useReaderUIStore.getState();
    if (state.reset) {
        state.reset();
    }
    // Manually ensure some defaults if reset doesn't cover everything or if we want a clean slate
    useReaderUIStore.setState({
      isLoading: false,
      currentBookId: null,
      currentCfi: null,
      currentSectionTitle: null,
      currentSectionId: null,
      progress: 0,
      toc: [],
      viewMode: 'paginated',
      immersiveMode: false,
      shouldForceFont: false
    });
  });

  it('should initialize with default values', () => {
    const state = useReaderUIStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.currentBookId).toBeNull();
    expect(state.immersiveMode).toBe(false);
    expect(state.viewMode).toBe('paginated');
  });

  it('should set current book id', () => {
    useReaderUIStore.getState().setCurrentBookId('book-123');
    expect(useReaderUIStore.getState().currentBookId).toBe('book-123');
  });

  it('should update location', () => {
    useReaderUIStore.getState().updateLocation('epubcfi(/6/4!/4/2)', 0.5, 'Chapter 1', 'chapter1.html');
    const state = useReaderUIStore.getState();
    expect(state.currentCfi).toBe('epubcfi(/6/4!/4/2)');
    expect(state.progress).toBe(0.5);
    expect(state.currentSectionTitle).toBe('Chapter 1');
    expect(state.currentSectionId).toBe('chapter1.html');
  });

  it('should set loading state', () => {
    useReaderUIStore.getState().setIsLoading(true);
    expect(useReaderUIStore.getState().isLoading).toBe(true);
  });

  it('should set immersive mode', () => {
    useReaderUIStore.getState().setImmersiveMode(true);
    expect(useReaderUIStore.getState().immersiveMode).toBe(true);
  });

  it('should reset state', () => {
    useReaderUIStore.setState({
      currentBookId: 'book-123',
      currentCfi: 'cfi',
      immersiveMode: true
    });

    useReaderUIStore.getState().reset();

    const state = useReaderUIStore.getState();
    expect(state.currentBookId).toBeNull();
    expect(state.currentCfi).toBeNull();
    expect(state.immersiveMode).toBe(false);
  });
});
