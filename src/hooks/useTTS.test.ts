import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useTTS } from './useTTS';
import { renderHook } from '@testing-library/react';
import { useTTSStore } from '../store/useTTSStore';
import { useReaderUIStore } from '../store/useReaderUIStore';
import { AudioPlayerService } from '../lib/tts/AudioPlayerService';

// Helper to create mocked store instance
const createMockStore = (initialState: any) => {
  const listeners = new Set<() => void>();
  let state = initialState;
  const getState = () => state;
  const setState = (partial: any) => {
    state = { ...state, ...partial };
    listeners.forEach((l) => l());
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const useStore = (selector: any) => selector(state);
  useStore.getState = getState;
  useStore.setState = setState;
  useStore.subscribe = subscribe;
  return useStore;
};

// Mocks
vi.mock('../store/useTTSStore', () => ({
  useTTSStore: vi.fn(),
}));

vi.mock('../store/useReaderUIStore', () => ({
  useReaderUIStore: vi.fn(),
}));

vi.mock('../lib/tts/AudioPlayerService');

describe('useTTS Hook', () => {
  const mockLoadVoices = vi.fn();
  const mockLoadSection = vi.fn();

  // Mock singleton methods
  const mockAudioPlayer = {
    loadSectionBySectionId: mockLoadSection,
    subscribe: vi.fn(() => vi.fn()),
    // Essential for store init if it accesses singleton
    getQueue: vi.fn().mockReturnValue([]),
    stop: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    setRate: vi.fn(),
    setVoice: vi.fn(),
    setVolume: vi.fn(),
    destroy: vi.fn(),
    setBackgroundAudioMode: vi.fn(),
    setPrerollEnabled: vi.fn(),
    setProvider: vi.fn(),
    init: vi.fn(),
    getVoices: vi.fn().mockResolvedValue([]),
    setBackgroundVolume: vi.fn(),
    setSpeed: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock Audio Player Singleton
    (AudioPlayerService.getInstance as any).mockReturnValue(mockAudioPlayer);

    // Mock Stores
    // We mock the hook implementation directly
    const ttsState = {
        loadVoices: mockLoadVoices,
        isPlaying: false,
    };
    (useTTSStore as any).mockImplementation((selector: any) => selector ? selector(ttsState) : ttsState);
    (useTTSStore as any).getState = () => ttsState;

    const readerState = {
        currentBookId: 'book-1',
        currentSectionId: 'section-1',
        currentSectionTitle: 'Chapter 1'
    };
    (useReaderUIStore as any).mockImplementation((selector: any) => selector ? selector(readerState) : readerState);
    (useReaderUIStore as any).getState = () => readerState;
  });

  afterEach(() => {
      vi.resetAllMocks();
  });

  it('should load voices on mount', () => {
    renderHook(() => useTTS());
    expect(mockLoadVoices).toHaveBeenCalled();
  });

  it('should sync queue when idle and identifiers change', () => {
    renderHook(() => useTTS());

    // Should call loadSectionBySectionId
    expect(mockLoadSection).toHaveBeenCalledWith('section-1', false, 'Chapter 1');
  });

  it('should NOT sync queue if playing', () => {
    // Setup playing state
    const ttsState = {
        loadVoices: mockLoadVoices,
        isPlaying: true,
    };
    (useTTSStore as any).getState = () => ttsState;

    renderHook(() => useTTS());

    expect(mockLoadSection).not.toHaveBeenCalled();
  });

  it('should NOT sync if bookId or sectionId is missing', () => {
     const readerState = {
        currentBookId: null,
        currentSectionId: null
    };
    (useReaderUIStore as any).mockImplementation((selector: any) => selector ? selector(readerState) : readerState);
    (useReaderUIStore as any).getState = () => readerState;

    renderHook(() => useTTS());
    expect(mockLoadSection).not.toHaveBeenCalled();
  });
});
