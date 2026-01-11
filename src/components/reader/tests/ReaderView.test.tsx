import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ReaderView } from '../ReaderView';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// --- Hoisted Helpers & Mocks ---

const {
  mockUIStore,
  mockSyncStore,
  mockTTSStore,
  mockProgressStore,
  mockAnnotationStore,
  mockGlobalUIStore,
  mockGenAIStore,
  mockSidebarStore,
  mockToastStore,
  mockEpubReaderResult,
  mockRendition
} = vi.hoisted(() => {
  // Store Factory
  const createMockStore = (initialState: any) => {
    let state = { ...initialState };
    const listeners = new Set();
    const getState = () => state;
    const setState = (partial: any) => {
      state = { ...state, ...partial };
      listeners.forEach((l: any) => l(state));
    };
    return { getState, setState, listeners };
  };

  // Mock Rendition (Complex Object)
  const mockRendition = {
    display: vi.fn(),
    prev: vi.fn(),
    next: vi.fn(),
    themes: {
      register: vi.fn(),
      select: vi.fn(),
      fontSize: vi.fn(),
      font: vi.fn(),
      default: vi.fn()
    },
    annotations: { add: vi.fn(), remove: vi.fn() },
    on: vi.fn(),
    off: vi.fn(),
    getContents: vi.fn(() => []),
    spread: vi.fn(),
    flow: vi.fn(),
    resize: vi.fn(),
    hooks: {
      content: { register: vi.fn(), deregister: vi.fn() }
    },
    manager: { container: { clientWidth: 1000 } },
    locations: {
      generate: vi.fn().mockResolvedValue(['cfi1']),
      percentageFromCfi: vi.fn(() => 0.5),
      save: vi.fn(() => '["cfi1"]'),
      load: vi.fn(),
      cfiFromPercentage: vi.fn(() => 'cfi1')
    },
    spine: {
      get: vi.fn(() => ({ label: 'Chapter 1', href: 'chap1.html' }))
    },
    destroy: vi.fn(),
  };

  // Stable Hook Result
  const mockEpubReaderResult = {
      rendition: mockRendition,
      book: {
          spine: { get: vi.fn(() => ({ href: 'chap1.html' })) },
          locations: mockRendition.locations
      },
      isReady: true,
      areLocationsReady: true,
      isLoading: false,
      metadata: { title: 'Test Book', version: 1000 },
      error: null
  };

  return {
    mockUIStore: createMockStore({
      viewMode: 'paginated',
      shouldForceFont: false,
      immersiveMode: false,
      toc: [],
      popover: { visible: false },
      currentSectionTitle: 'Chapter 1',
      currentSectionId: 'chap1.html',
      updateLocation: vi.fn(),
      updateSection: vi.fn(),
      setToc: vi.fn(),
      setIsLoading: vi.fn(),
      setCurrentBookId: vi.fn(),
      reset: vi.fn(),
      setImmersiveMode: vi.fn(),
      showPopover: vi.fn(),
      hidePopover: vi.fn(),
      setPlayFromSelection: vi.fn()
    }),
    mockSyncStore: createMockStore({
      currentTheme: 'light',
      customTheme: null,
      fontFamily: 'serif',
      fontSize: 100,
      lineHeight: 1.5,
      setTheme: vi.fn(),
      setFontSize: vi.fn(),
      setFontFamily: vi.fn(),
      setLineHeight: vi.fn(),
      setShouldForceFont: vi.fn()
    }),
    mockTTSStore: createMockStore({
      isPlaying: false,
      activeCfi: null,
      lastError: null,
      clearError: vi.fn(),
      voices: [],
      loadVoices: vi.fn()
    }),
    mockProgressStore: createMockStore({
      updateProgress: vi.fn()
    }),
    mockAnnotationStore: createMockStore({
      annotations: {}
    }),
    mockGlobalUIStore: createMockStore({
      setGlobalSettingsOpen: vi.fn()
    }),
    mockGenAIStore: createMockStore({
      isDebugModeEnabled: false
    }),
    mockSidebarStore: createMockStore({
      activeSidebar: 'none',
      setSidebar: vi.fn()
    }),
    mockToastStore: createMockStore({
      showToast: vi.fn()
    }),
    mockEpubReaderResult,
    mockRendition
  };
});

// --- Mock Implementations ---

vi.mock('epubjs');

// Explicitly mock DBService to prevent real DB calls
vi.mock('../../../db/DBService', () => ({
  dbService: {
    updateReadingHistory: vi.fn().mockResolvedValue(undefined),
    getReadingHistory: vi.fn().mockResolvedValue([]),
    getContentAnalysis: vi.fn().mockResolvedValue(null)
  }
}));

// Mock low-level DB access just in case
vi.mock('../../../db/db', () => ({
  getDB: vi.fn(() => Promise.resolve({
    get: vi.fn(),
    getAllFromIndex: vi.fn(),
    put: vi.fn(),
    transaction: vi.fn()
  })),
}));

vi.mock('../../../hooks/useTTS', () => ({
  useTTS: () => ({
    voices: [],
    speak: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    isPlaying: false,
    isPaused: false,
  })
}));

vi.mock('../../../lib/tts/AudioPlayerService', () => ({
  AudioPlayerService: {
    getInstance: vi.fn(() => ({
      setBookId: vi.fn(),
      getQueue: vi.fn(() => []),
      jumpTo: vi.fn(),
      skipToNextSection: vi.fn(),
      skipToPreviousSection: vi.fn(),
    }))
  }
}));

// Use stable result for useEpubReader
vi.mock('../../../hooks/useEpubReader', () => ({
  useEpubReader: () => mockEpubReaderResult
}));

vi.mock('../../../lib/search', () => ({
  searchClient: {
    indexBook: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    terminate: vi.fn(),
    isIndexed: vi.fn().mockReturnValue(true)
  }
}));

vi.mock('../UnifiedInputController', () => ({
  UnifiedInputController: ({ onPrev, onNext }: { onPrev: () => void, onNext: () => void }) => (
    <div data-testid="unified-input-controller">
      <button data-testid="mock-prev" onClick={onPrev}>Prev</button>
      <button data-testid="mock-next" onClick={onNext}>Next</button>
    </div>
  )
}));

vi.mock('zustand/react/shallow', () => ({
  useShallow: (selector: any) => selector
}));

vi.mock('../../../hooks/useSmartTOC', () => ({
    useSmartTOC: () => ({
        enhanceTOC: vi.fn(),
        isEnhancing: false,
        progress: null
    })
}));

// Use Object.assign to link the mocked stores to our hoisted state
// This allows the test to control the state while the component consumes it via the mock
vi.mock('../../../store/useReaderUIStore', async () => ({
  useReaderUIStore: Object.assign(
      (selector: any) => selector(mockUIStore.getState()),
      { getState: () => mockUIStore.getState(), setState: mockUIStore.setState }
  )
}));

vi.mock('../../../store/useReaderSyncStore', async () => ({
  useReaderSyncStore: Object.assign(
      (selector: any) => selector(mockSyncStore.getState()),
      { getState: () => mockSyncStore.getState(), setState: mockSyncStore.setState }
  )
}));

vi.mock('../../../store/useTTSStore', async () => ({
  useTTSStore: Object.assign(
      (selector: any) => selector(mockTTSStore.getState()),
      { getState: () => mockTTSStore.getState(), setState: mockTTSStore.setState }
  )
}));

vi.mock('../../../store/useProgressStore', async () => ({
  useProgressStore: Object.assign(
      (selector: any) => selector ? selector(mockProgressStore.getState()) : mockProgressStore.getState(),
      { getState: () => mockProgressStore.getState(), setState: mockProgressStore.setState }
  )
}));

vi.mock('../../../store/useAnnotationStore', async () => ({
  useAnnotationStore: Object.assign(
      (selector: any) => selector ? selector(mockAnnotationStore.getState()) : mockAnnotationStore.getState(),
      { getState: () => mockAnnotationStore.getState(), setState: mockAnnotationStore.setState }
  )
}));

vi.mock('../../../store/useUIStore', async () => ({
  useUIStore: Object.assign(
      (selector: any) => selector ? selector(mockGlobalUIStore.getState()) : mockGlobalUIStore.getState(),
      { getState: () => mockGlobalUIStore.getState(), setState: mockGlobalUIStore.setState }
  )
}));

vi.mock('../../../store/useGenAIStore', async () => ({
  useGenAIStore: Object.assign(
      (selector: any) => selector ? selector(mockGenAIStore.getState()) : mockGenAIStore.getState(),
      { getState: () => mockGenAIStore.getState(), setState: mockGenAIStore.setState }
  )
}));

vi.mock('../../../hooks/useSidebarState', async () => ({
  useSidebarState: Object.assign(
      (selector: any) => selector ? selector(mockSidebarStore.getState()) : mockSidebarStore.getState(),
      { getState: () => mockSidebarStore.getState(), setState: mockSidebarStore.setState }
  )
}));

vi.mock('../../../store/useToastStore', async () => ({
  useToastStore: Object.assign(
      (selector: any) => selector ? selector(mockToastStore.getState()) : mockToastStore.getState(),
      { getState: () => mockToastStore.getState(), setState: mockToastStore.setState }
  )
}));

describe('ReaderView', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUIStore.setState({
      viewMode: 'paginated',
      shouldForceFont: false,
      immersiveMode: false,
      toc: [],
      popover: { visible: false },
      currentSectionTitle: 'Chapter 1',
      currentSectionId: 'chap1.html',
    });
    mockSyncStore.setState({
      currentTheme: 'light',
      fontSize: 100,
    });
    mockTTSStore.setState({
      isPlaying: false,
      activeCfi: null,
      lastError: null,
      voices: [],
    });
    mockSidebarStore.setState({
      activeSidebar: 'none'
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderComponent = (id = 'test-book-id') => {
    return render(
      <MemoryRouter initialEntries={[`/read/${id}`]}>
        <Routes>
          <Route path="/read/:id" element={<ReaderView />} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('initializes epub.js and renders book', async () => {
    renderComponent();

    await waitFor(() => {
      // Check if the global rendition was set (effect in ReaderView)
      expect((window as any).rendition).toBeDefined();
    });
  });

  it('handles navigation (next/prev) via UnifiedInputController', async () => {
    renderComponent();

    await waitFor(() => expect(screen.getByTestId('unified-input-controller')).toBeInTheDocument());

    const prevBtn = screen.getByTestId('mock-prev');
    const nextBtn = screen.getByTestId('mock-next');

    // Verify method calls on the stable mock instance
    fireEvent.click(prevBtn);
    expect(mockRendition.prev).toHaveBeenCalled();

    fireEvent.click(nextBtn);
    expect(mockRendition.next).toHaveBeenCalled();
  });

  it('toggles TOC', async () => {
    renderComponent();

    const tocBtn = screen.getByLabelText('Table of Contents');
    fireEvent.click(tocBtn);

    // Verify store update via the spy
    expect(mockSidebarStore.getState().setSidebar).toHaveBeenCalledWith('toc');
  });

  it('updates settings', async () => {
    renderComponent();

    const visualSettingsBtn = screen.getByLabelText('Visual Settings');
    fireEvent.click(visualSettingsBtn);

    expect(mockSidebarStore.getState().setSidebar).toHaveBeenCalledWith('visual-settings');
  });
});
