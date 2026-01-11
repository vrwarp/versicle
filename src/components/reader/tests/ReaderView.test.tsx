import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ReaderView } from '../ReaderView';
import { useReaderUIStore } from '../../../store/useReaderUIStore';
import { useReaderSyncStore } from '../../../store/useReaderSyncStore';
import { useTTSStore } from '../../../store/useTTSStore';
import ePub from 'epubjs';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CURRENT_BOOK_VERSION } from '../../../lib/constants';

// Mock dependencies
vi.mock('epubjs');
vi.mock('../../../db/db', () => ({
  getDB: vi.fn(() => Promise.resolve({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    get: vi.fn((store, _id) => {
      if (store === 'static_resources') return Promise.resolve({ bookId: 'test-book-id', epubBlob: new ArrayBuffer(10) });

      if (store === 'static_manifests') return Promise.resolve({
        bookId: 'test-book-id', title: 'Test Book', author: 'Author',
        fileHash: 'hash', fileSize: 100, totalChars: 100, schemaVersion: CURRENT_BOOK_VERSION,
        coverBlob: new Blob([''])
      });

      if (store === 'user_inventory') return Promise.resolve({
        bookId: 'test-book-id', addedAt: Date.now(), status: 'reading', lastInteraction: Date.now()
      });

      if (store === 'user_progress') return Promise.resolve({
        bookId: 'test-book-id', percentage: 0, lastRead: Date.now(), completedRanges: []
      });

      return Promise.resolve(null);
    }),
    getAllFromIndex: vi.fn(() => Promise.resolve([])),
    put: vi.fn(() => Promise.resolve()),
    transaction: vi.fn(() => ({
      objectStore: vi.fn((name) => ({
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        get: vi.fn((_id) => {
          if (name === 'static_resources') return Promise.resolve({ bookId: 'test-book-id', epubBlob: new ArrayBuffer(10) });
          if (name === 'static_manifests') return Promise.resolve({
            bookId: 'test-book-id', title: 'Test Book', author: 'Author',
            fileHash: 'hash', fileSize: 100, totalChars: 100, schemaVersion: CURRENT_BOOK_VERSION
          });
          if (name === 'user_inventory') return Promise.resolve({
            bookId: 'test-book-id', addedAt: Date.now(), status: 'reading', lastInteraction: Date.now()
          });
          if (name === 'user_progress') return Promise.resolve({
            bookId: 'test-book-id', percentage: 0, lastRead: Date.now(), completedRanges: []
          });
          return Promise.resolve(null);
        }),
        put: vi.fn()
      })),
      done: Promise.resolve()
    }))
  })),
}));

// Mock searchClient
vi.mock('../../../lib/search', () => ({
  searchClient: {
    indexBook: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    terminate: vi.fn(),
    isIndexed: vi.fn().mockReturnValue(true) // prevent indexing loop
  }
}));

// Mock UnifiedInputController
vi.mock('../UnifiedInputController', () => ({
  UnifiedInputController: ({ onPrev, onNext }: { onPrev: () => void, onNext: () => void }) => (
    <div data-testid="unified-input-controller">
      <button data-testid="mock-prev" onClick={onPrev}>Prev</button>
      <button data-testid="mock-next" onClick={onNext}>Next</button>
    </div>
  )
}));

// Mock Stores (so we can assert on them)
// We need to use real Zustand stores OR mock them with state?
// Since we want integration test style where components update stores, let's use actual stores or a factory that behaves like them.
// Actually, vitest mocks for modules will replace the module exports.
// If we want the component to USE the store AND we want to assert on it, better not to mock the module completely returning undefined, 
// but use the actual store implementation if possible, OR mock with a state container.
// Given strict mocking in previous tests, let's mock with a simple state implementation.

const createMockStore = (initialState: any) => {
  let state = { ...initialState };
  const listeners = new Set();

  const fn = (selector?: any) => {
    return selector ? selector(state) : state;
  }
  fn.getState = () => state;
  fn.setState = (partial: any) => {
    state = { ...state, ...partial };
    listeners.forEach((l: any) => l(state));
  };
  fn.subscribe = (l: any) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  return fn;
};

// Hoisted store mocks
const mockUseReaderUIStore = createMockStore({
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
  setImmersiveMode: vi.fn((val: boolean) => mockUseReaderUIStore.setState({ immersiveMode: val })),
  showPopover: vi.fn(),
  hidePopover: vi.fn(),
  setPlayFromSelection: vi.fn()
});

const mockUseReaderSyncStore = createMockStore({
  currentTheme: 'light',
  customTheme: null,
  fontFamily: 'serif',
  fontSize: 100,
  lineHeight: 1.5,
  setTheme: vi.fn((val: string) => mockUseReaderSyncStore.setState({ currentTheme: val })),
  setFontSize: vi.fn(),
  setFontFamily: vi.fn(),
  setLineHeight: vi.fn(),
  setShouldForceFont: vi.fn((val: boolean) => mockUseReaderUIStore.setState({ shouldForceFont: val })) // Note: Force font usually in UI store? VisualSettings.tsx line 23 says UIStore.
});
// Correction: VisualSettings.tsx line 23: { ... setShouldForceFont } = useReaderUIStore
// So force font is in UI Store.

vi.mock('../../../store/useReaderUIStore', () => ({
  useReaderUIStore: (selector: any) => mockUseReaderUIStore(selector)
}));

vi.mock('../../../store/useReaderSyncStore', () => ({
  useReaderSyncStore: (selector: any) => mockUseReaderSyncStore(selector)
}));

vi.mock('../../../store/useTTSStore', () => {
  const store = createMockStore({
    isPlaying: false,
    activeCfi: null,
    lastError: null,
    clearError: vi.fn()
  });
  return {
    useTTSStore: (selector: any) => store(selector)
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

    // Reset store states
    mockUseReaderUIStore.setState({
      viewMode: 'paginated',
      shouldForceFont: false,
      immersiveMode: false,
      toc: [],
      popover: { visible: false },
      currentSectionTitle: 'Chapter 1',
      currentSectionId: 'chap1.html',
    });
    mockUseReaderSyncStore.setState({
      currentTheme: 'light',
      fontSize: 100,
    });

    // Mock epubjs instance
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
          content: {
            register: vi.fn(),
            deregister: vi.fn()
          }
        },
        manager: {
          container: { clientWidth: 1000 }
        },
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

    // Wait for the mock component to appear
    await waitFor(() => expect(screen.getByTestId('unified-input-controller')).toBeInTheDocument());

    // Click mock buttons exposed by UnifiedInputController mock
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

    // Reset immersive mode to false so header buttons are visible
    act(() => {
      mockUseReaderUIStore.setState({ immersiveMode: false });
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

    // Reset immersive mode to false so header buttons are visible
    act(() => {
      mockUseReaderUIStore.setState({ immersiveMode: false });
    });

    // Open Visual Settings (Theme, Font, etc.)
    const visualSettingsBtn = screen.getByLabelText('Visual Settings');
    fireEvent.click(visualSettingsBtn);

    // Change Theme
    const darkThemeBtn = await screen.findByLabelText('Select Dark theme');
    fireEvent.click(darkThemeBtn);

    expect(mockUseReaderSyncStore.getState().currentTheme).toBe('dark');

    // Toggle Force Theme
    // We use getByRole for switch as it might not be labeled by text directly in a way JSDOM likes with Radix
    const forceThemeSwitch = screen.getByRole('switch', { name: 'Force Theme' });
    fireEvent.click(forceThemeSwitch);

    expect(mockUseReaderUIStore.getState().shouldForceFont).toBe(true);
  });
});
