import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ReaderView } from '../ReaderView';
import { useReaderUIStore } from '../../../store/useReaderUIStore';
import { useReadingStateStore } from '../../../store/useReadingStateStore';
import { usePreferencesStore } from '../../../store/usePreferencesStore';
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
  }
}));

// Mock UnifiedInputController to isolate ReaderView testing
vi.mock('../UnifiedInputController', () => ({
  UnifiedInputController: ({ onPrev, onNext }: { onPrev: () => void, onNext: () => void }) => (
    <div data-testid="unified-input-controller">
      <button data-testid="mock-prev" onClick={onPrev}>Prev</button>
      <button data-testid="mock-next" onClick={onNext}>Next</button>
    </div>
  )
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
    vi.spyOn(console, 'warn').mockImplementation(() => {});

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
        }
      }),
      ready: Promise.resolve(),
      loaded: {
        navigation: Promise.resolve({ toc: [{ id: '1', label: 'Chapter 1', href: 'chap1.html' }] })
      },
      locations: {
        generate: vi.fn().mockResolvedValue(['cfi1']),
        percentageFromCfi: vi.fn(() => 0.5),
        save: vi.fn(() => '["cfi1"]'),
        load: vi.fn()
      },
      spine: {
        get: vi.fn(() => ({ label: 'Chapter 1' }))
      },
      destroy: vi.fn(),
    });

    useReadingStateStore.setState({
      progress: {},
      updateLocation: vi.fn(),
      getProgress: vi.fn(),
      reset: vi.fn(),
    });

    useReaderUIStore.setState({
      isLoading: false,
      toc: [],
      immersiveMode: false,
      currentSectionTitle: null,
      currentSectionId: null,
      currentBookId: null,
      reset: vi.fn(),
      setToc: (toc) => useReaderUIStore.setState({ toc }),
      setIsLoading: (isLoading) => useReaderUIStore.setState({ isLoading }),
      setCurrentSection: (title, id) => useReaderUIStore.setState({ currentSectionTitle: title, currentSectionId: id }),
      setCurrentBookId: (id) => useReaderUIStore.setState({ currentBookId: id }),
    });

    usePreferencesStore.setState({
      currentTheme: 'light',
      fontSize: 100,
      shouldForceFont: false,
      readerViewMode: 'paginated',
    });

    useTTSStore.setState({
      isPlaying: false,
      activeCfi: null
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
      useReaderUIStore.setState({ immersiveMode: false });
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
      useReaderUIStore.setState({ immersiveMode: false });
    });

    // Open Visual Settings (Theme, Font, etc.)
    const visualSettingsBtn = screen.getByLabelText('Visual Settings');
    fireEvent.click(visualSettingsBtn);

    // Change Theme
    const darkThemeBtn = await screen.findByLabelText('Select Dark theme');
    fireEvent.click(darkThemeBtn);

    expect(usePreferencesStore.getState().currentTheme).toBe('dark');

    // Toggle Force Theme
    // We use getByRole for switch as it might not be labeled by text directly in a way JSDOM likes with Radix
    const forceThemeSwitch = screen.getByRole('switch', { name: 'Force Theme' });
    fireEvent.click(forceThemeSwitch);

    expect(usePreferencesStore.getState().shouldForceFont).toBe(true);
  });
  it('resumes reading from stored position', async () => {
    // Set up initial reading state with per-device progress structure
    const deviceId = 'test-device';
    const storedProgress = {
      bookId: 'test-book-id',
      currentCfi: 'epubcfi(/6/4!/4/2/2)',
      percentage: 0.5,
      lastRead: Date.now(),
      completedRanges: []
    };

    useReadingStateStore.setState({
      progress: {
        'test-book-id': {
          [deviceId]: storedProgress
        }
      },
      // getProgress should return the max progress entry
      getProgress: (bookId: string) => bookId === 'test-book-id' ? storedProgress : null
    });

    renderComponent();

    await waitFor(() => {
      expect(mockDisplay).toHaveBeenCalledWith('epubcfi(/6/4!/4/2/2)');
    });
  });
});
