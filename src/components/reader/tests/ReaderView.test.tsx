import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ReaderView } from '../ReaderView';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CURRENT_BOOK_VERSION } from '../../../lib/constants';

// Helper for shallow comparison (Inlined in mocks)
const shallowEqual = (objA: any, objB: any) => {
    if (Object.is(objA, objB)) return true;
    if (typeof objA !== 'object' || objA === null || typeof objB !== 'object' || objB === null) return false;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) return false;
    for (let i = 0; i < keysA.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(objB, keysA[i]) || !Object.is(objA[keysA[i]], objB[keysA[i]])) {
        return false;
      }
    }
    return true;
};

// Hoist helper for store creation
const { createMockStore, mockUIStore, mockSyncStore, mockTTSStore } = vi.hoisted(() => {
  const createMockStore = (initialState: any) => {
    let state = { ...initialState };
    const listeners = new Set();

    const getState = () => state;
    const setState = (partial: any) => {
      // Optimization to prevent loops: if state hasn't changed, don't notify
      const nextState = { ...state, ...partial };
      // Note: we can't use shallowEqual here easily without inlining it inside hoisted block or repeating.
      // Let's assume notifications happen but listeners filter.
      state = nextState;
      listeners.forEach((l: any) => l(state));
    };
    return { getState, setState, listeners };
  };

  const mockUIStore = createMockStore({
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
    setImmersiveMode: vi.fn((val: boolean) => mockUIStore.setState({ immersiveMode: val })),
    showPopover: vi.fn(),
    hidePopover: vi.fn(),
    setPlayFromSelection: vi.fn()
  });

  const mockSyncStore = createMockStore({
    currentTheme: 'light',
    customTheme: null,
    fontFamily: 'serif',
    fontSize: 100,
    lineHeight: 1.5,
    setTheme: vi.fn((val: string) => mockSyncStore.setState({ currentTheme: val })),
    setFontSize: vi.fn(),
    setFontFamily: vi.fn(),
    setLineHeight: vi.fn(),
    setShouldForceFont: vi.fn((val: boolean) => mockUIStore.setState({ shouldForceFont: val }))
  });

  const mockTTSStore = createMockStore({
    isPlaying: false,
    activeCfi: null,
    lastError: null,
    clearError: vi.fn(),
    voices: [],
    loadVoices: vi.fn()
  });

  return { createMockStore, mockUIStore, mockSyncStore, mockTTSStore };
});

// Mock dependencies
vi.mock('epubjs');
vi.mock('../../../db/db', () => ({
  getDB: vi.fn(() => Promise.resolve({
    get: vi.fn((store, _id) => {
      if (store === 'static_resources') return Promise.resolve({ bookId: 'test-book-id', epubBlob: new ArrayBuffer(10) });
      if (store === 'static_manifests') return Promise.resolve({
        bookId: 'test-book-id', title: 'Test Book', author: 'Author',
        fileHash: 'hash', fileSize: 100, totalChars: 100, schemaVersion: CURRENT_BOOK_VERSION,
        coverBlob: new Blob([''])
      });
      return Promise.resolve(null);
    }),
    getAllFromIndex: vi.fn(() => Promise.resolve([])),
    put: vi.fn(() => Promise.resolve()),
    transaction: vi.fn(() => ({
      objectStore: vi.fn((name) => ({
        get: vi.fn((_id) => Promise.resolve(null)),
        put: vi.fn()
      })),
      done: Promise.resolve()
    }))
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

// Mock AudioPlayerService to prevent side-effects/accessing real store
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

// Mock useEpubReader with specific logic
vi.mock('../../../hooks/useEpubReader', () => {
  // Use simple mocks without internal state tracking if possible to avoid complexity
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
      book: {},
      isReady: true,
      areLocationsReady: true,
      isLoading: false,
      metadata: { title: 'Test Book' },
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

// Inline Mock Hooks using refs to stabilize selectors and avoid update loops
vi.mock('../../../store/useReaderUIStore', async () => {
  const React = await import('react');
  return {
    useReaderUIStore: (selector: any) => {
        // Stabilize selector by running it once or tracking changes
        const selectorRef = React.useRef(selector);
        selectorRef.current = selector;

        // Initial value using lazy initialization to avoid side-effects during initial render
        const [val, setVal] = React.useState(() => selector(mockUIStore.getState()));

        // Use a ref for value to avoid duplicate updates from strict mode or race conditions
        const valRef = React.useRef(val);

        React.useEffect(() => {
            const cb = () => {
                // Ensure we use the CURRENT selector
                const next = selectorRef.current(mockUIStore.getState());
                // Only update state if DEEP/SHALLOW different
                // Since test selectors might return new objects, we check properties
                if (!shallowEqual(valRef.current, next)) {
                    valRef.current = next;
                    setVal(next);
                }
            };
            mockUIStore.listeners.add(cb);
            return () => mockUIStore.listeners.delete(cb);
        }, []);
        return val;
    }
  };
});

vi.mock('../../../store/useReaderSyncStore', async () => {
  const React = await import('react');
  return {
    useReaderSyncStore: (selector: any) => {
        const selectorRef = React.useRef(selector);
        selectorRef.current = selector;
        const [val, setVal] = React.useState(() => selector(mockSyncStore.getState()));
        const valRef = React.useRef(val);

        React.useEffect(() => {
            const cb = () => {
                const next = selectorRef.current(mockSyncStore.getState());
                if (!shallowEqual(valRef.current, next)) {
                    valRef.current = next;
                    setVal(next);
                }
            };
            mockSyncStore.listeners.add(cb);
            return () => mockSyncStore.listeners.delete(cb);
        }, []);
        return val;
    }
  };
});

vi.mock('../../../store/useTTSStore', async () => {
  const React = await import('react');
  return {
    useTTSStore: (selector: any) => {
        const selectorRef = React.useRef(selector);
        selectorRef.current = selector;
        const [val, setVal] = React.useState(() => selector(mockTTSStore.getState()));
        const valRef = React.useRef(val);

        React.useEffect(() => {
            const cb = () => {
                const next = selectorRef.current(mockTTSStore.getState());
                if (!shallowEqual(valRef.current, next)) {
                    valRef.current = next;
                    setVal(next);
                }
            };
            mockTTSStore.listeners.add(cb);
            return () => mockTTSStore.listeners.delete(cb);
        }, []);
        return val;
    }
  };
});


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

    // Access the mocked useEpubReader hook's internal rendition via global or expected mock interaction
    const rendition = (window as any).rendition;
    expect(rendition).toBeDefined();

    fireEvent.click(prevBtn);
    expect(rendition.prev).toHaveBeenCalled();

    fireEvent.click(nextBtn);
    expect(rendition.next).toHaveBeenCalled();
  });

  it('toggles TOC', async () => {
    renderComponent();

    act(() => {
      mockUIStore.setState({ immersiveMode: false });
    });

    const tocBtn = screen.getByLabelText('Table of Contents');
    fireEvent.click(tocBtn);

    await waitFor(() => {
        expect(screen.getByTestId('reader-toc-sidebar')).toBeInTheDocument();
    });
  });

  it('updates settings', async () => {
    renderComponent();

    act(() => {
      mockUIStore.setState({ immersiveMode: false });
    });

    const visualSettingsBtn = screen.getByLabelText('Visual Settings');
    fireEvent.click(visualSettingsBtn);

    const darkThemeBtn = await screen.findByLabelText('Select Dark theme');
    fireEvent.click(darkThemeBtn);

    expect(mockSyncStore.getState().currentTheme).toBe('dark');

    const forceThemeSwitch = screen.getByRole('switch', { name: 'Force Theme' });
    fireEvent.click(forceThemeSwitch);

    expect(mockUIStore.getState().shouldForceFont).toBe(true);
  });
});
