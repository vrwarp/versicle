import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ReaderView } from '../ReaderView';
import ePub from 'epubjs';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CURRENT_BOOK_VERSION } from '../../../lib/constants';

// Hoist helper for store creation
const { createMockStore, mockUIStore, mockSyncStore, mockTTSStore } = vi.hoisted(() => {
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

// Reactive Mocks using safe function updates and refs for selectors
const createSafeHook = (store: any) => async () => {
  const React = await import('react');
  return {
    // Dynamic
  };
};

vi.mock('../../../store/useReaderUIStore', async () => {
  const React = await import('react');
  return {
    useReaderUIStore: (selector: any) => {
        const selectorRef = React.useRef(selector);
        selectorRef.current = selector;
        const [val, setVal] = React.useState(() => selector(mockUIStore.getState()));
        React.useEffect(() => {
            const cb = () => {
                const next = selectorRef.current(mockUIStore.getState());
                setVal(() => next);
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
        React.useEffect(() => {
            const cb = () => {
                const next = selectorRef.current(mockSyncStore.getState());
                setVal(() => next);
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
        React.useEffect(() => {
            const cb = () => {
                const next = selectorRef.current(mockTTSStore.getState());
                setVal(() => next);
            };
            mockTTSStore.listeners.add(cb);
            return () => mockTTSStore.listeners.delete(cb);
        }, []);
        return val;
    }
  };
});

vi.mock('zustand/react/shallow', () => ({
  useShallow: (selector: any) => selector
}));


describe('ReaderView', () => {
  const mockRenderTo = vi.fn();
  const mockDisplay = vi.fn();
  const mockPrev = vi.fn();
  const mockNext = vi.fn();
  const mockRegister = vi.fn();
  const mockSelect = vi.fn();
  const mockFontSize = vi.fn();
  const mockFont = vi.fn();
  const mockAnnotations = { add: vi.fn(), remove: vi.fn() };
  const mockDefault = vi.fn();

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ePub as any).mockReturnValue({
      renderTo: mockRenderTo.mockReturnValue({
        display: mockDisplay,
        prev: mockPrev,
        next: mockNext,
        themes: {
          register: mockRegister,
          select: mockSelect,
          fontSize: mockFontSize,
          font: mockFont,
          default: mockDefault
        },
        annotations: mockAnnotations,
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
      }),
      ready: Promise.resolve(),
      loaded: {
        navigation: Promise.resolve({ toc: [{ id: '1', label: 'Chapter 1', href: 'chap1.html' }] })
      },
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
      expect(ePub).toHaveBeenCalled();
      expect(mockRenderTo).toHaveBeenCalled();
      expect(mockDisplay).toHaveBeenCalled();
    });
  });

  it('handles navigation (next/prev) via UnifiedInputController', async () => {
    renderComponent();

    await waitFor(() => expect(mockRenderTo).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('unified-input-controller')).toBeInTheDocument());

    const prevBtn = screen.getByTestId('mock-prev');
    const nextBtn = screen.getByTestId('mock-next');

    fireEvent.click(prevBtn);
    expect(mockPrev).toHaveBeenCalled();

    fireEvent.click(nextBtn);
    expect(mockNext).toHaveBeenCalled();
  });

  it('toggles TOC', async () => {
    renderComponent();
    await waitFor(() => expect(mockRenderTo).toHaveBeenCalled());

    act(() => {
      mockUIStore.setState({ immersiveMode: false });
    });

    const tocBtn = screen.getByLabelText('Table of Contents');
    fireEvent.click(tocBtn);

    await waitFor(() => {
      expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    });
  });

  it('updates settings', async () => {
    renderComponent();
    await waitFor(() => expect(mockRenderTo).toHaveBeenCalled());

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
