import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ReaderView } from '../ReaderView';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CURRENT_BOOK_VERSION } from '../../../lib/constants';

// Hoist helper for store creation
const {
  mockUIStore,
  mockSyncStore,
  mockTTSStore,
  mockProgressStore,
  mockAnnotationStore,
  mockGlobalUIStore,
  mockGenAIStore,
  mockSidebarStore,
  mockToastStore
} = vi.hoisted(() => {
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
    })
  };
});

// Mock dependencies
vi.mock('epubjs');
vi.mock('../../../db/db', () => ({
  dbService: {
    updateReadingHistory: vi.fn().mockResolvedValue(undefined),
    getReadingHistory: vi.fn().mockResolvedValue([]),
    getContentAnalysis: vi.fn().mockResolvedValue(null)
  },
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

// Mock AudioPlayerService
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

// Mock useEpubReader
vi.mock('../../../hooks/useEpubReader', () => {
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

  return {
    useEpubReader: () => ({
      rendition: mockRendition,
      book: {
          spine: { get: vi.fn(() => ({ href: 'chap1.html' })) },
          locations: mockRendition.locations
      },
      isReady: true,
      areLocationsReady: true,
      isLoading: false,
      metadata: { title: 'Test Book', version: CURRENT_BOOK_VERSION },
      error: null
    })
  };
});

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

// Inline Mock Hooks for ALL stores used in ReaderView

vi.mock('../../../store/useReaderUIStore', async () => ({
  useReaderUIStore: Object.assign(
      (selector: any) => selector(mockUIStore.getState()),
      { getState: () => mockUIStore.getState() }
  )
}));

vi.mock('../../../store/useReaderSyncStore', async () => ({
  useReaderSyncStore: Object.assign(
      (selector: any) => selector(mockSyncStore.getState()),
      { getState: () => mockSyncStore.getState() }
  )
}));

vi.mock('../../../store/useTTSStore', async () => ({
  useTTSStore: Object.assign(
      (selector: any) => selector(mockTTSStore.getState()),
      { getState: () => mockTTSStore.getState() }
  )
}));

vi.mock('../../../store/useProgressStore', async () => ({
  useProgressStore: Object.assign(
      (selector: any) => selector ? selector(mockProgressStore.getState()) : mockProgressStore.getState(),
      { getState: () => mockProgressStore.getState() }
  )
}));

vi.mock('../../../store/useAnnotationStore', async () => ({
  useAnnotationStore: Object.assign(
      (selector: any) => selector ? selector(mockAnnotationStore.getState()) : mockAnnotationStore.getState(),
      { getState: () => mockAnnotationStore.getState() }
  )
}));

vi.mock('../../../store/useUIStore', async () => ({
  useUIStore: Object.assign(
      (selector: any) => selector ? selector(mockGlobalUIStore.getState()) : mockGlobalUIStore.getState(),
      { getState: () => mockGlobalUIStore.getState() }
  )
}));

vi.mock('../../../store/useGenAIStore', async () => ({
  useGenAIStore: Object.assign(
      (selector: any) => selector ? selector(mockGenAIStore.getState()) : mockGenAIStore.getState(),
      { getState: () => mockGenAIStore.getState() }
  )
}));

vi.mock('../../../hooks/useSidebarState', async () => ({
  useSidebarState: Object.assign(
      (selector: any) => selector ? selector(mockSidebarStore.getState()) : mockSidebarStore.getState(),
      { getState: () => mockSidebarStore.getState() }
  )
}));

vi.mock('../../../store/useToastStore', async () => ({
  useToastStore: Object.assign(
      (selector: any) => selector ? selector(mockToastStore.getState()) : mockToastStore.getState(),
      { getState: () => mockToastStore.getState() }
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
      expect((window as any).rendition).toBeDefined();
    });
  });

  it('handles navigation (next/prev) via UnifiedInputController', async () => {
    renderComponent();

    await waitFor(() => expect(screen.getByTestId('unified-input-controller')).toBeInTheDocument());

    const prevBtn = screen.getByTestId('mock-prev');
    const nextBtn = screen.getByTestId('mock-next');

    const rendition = (window as any).rendition;
    expect(rendition).toBeDefined();

    fireEvent.click(prevBtn);
    expect(rendition.prev).toHaveBeenCalled();

    fireEvent.click(nextBtn);
    expect(rendition.next).toHaveBeenCalled();
  });

  it('toggles TOC', async () => {
    renderComponent();

    // Test TOC toggle interaction
    const tocBtn = screen.getByLabelText('Table of Contents');
    fireEvent.click(tocBtn);

    // We mocked useSidebarState to return whatever is in mockSidebarStore.
    // However, since it is a "dumb" mock (pure return), calling setSidebar won't trigger a re-render
    // of the component because the hook won't emit a new value to React.

    // But we can check if the setter was called.
    expect(mockSidebarStore.getState().setSidebar).toHaveBeenCalledWith('toc');

    // To test that the sidebar APPEARS, we need to manually update the store state and re-render.
    // In a real test with "dumb" mocks, the component doesn't auto-update.
    // So we assume that if the setter is called, the integration works.

    // If we want to verify rendering:
    // We can manually force the mock to return 'toc' for the next render.
    mockSidebarStore.setState({ activeSidebar: 'toc' });

    // Re-render
    renderComponent();
    await waitFor(() => {
        expect(screen.getByTestId('reader-toc-sidebar')).toBeInTheDocument();
    });
  });

  it('updates settings', async () => {
    renderComponent();

    const visualSettingsBtn = screen.getByLabelText('Visual Settings');
    fireEvent.click(visualSettingsBtn);

    // Sidebar should open 'visual-settings'
    expect(mockSidebarStore.getState().setSidebar).toHaveBeenCalledWith('visual-settings');
  });
});
