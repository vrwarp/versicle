import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ReaderView } from '../ReaderView';
import { useReaderStore } from '../../../store/useReaderStore';
import { useTTSStore } from '../../../store/useTTSStore';
import ePub from 'epubjs';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Mock dependencies
vi.mock('epubjs');
vi.mock('../../../db/db', () => ({
  getDB: vi.fn(() => Promise.resolve({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    get: vi.fn((store, id) => {
      if (store === 'files') return Promise.resolve(new ArrayBuffer(10));
      if (store === 'books') return Promise.resolve({ title: 'Test Book' });
      return Promise.resolve(null);
    }),
    getAllFromIndex: vi.fn(() => Promise.resolve([])), // Mock annotations fetch
    put: vi.fn(() => Promise.resolve()), // Mock put for caching locations
    transaction: vi.fn(() => ({
        objectStore: vi.fn(() => ({
            get: vi.fn(),
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

    useReaderStore.setState({
      currentBookId: null,
      isLoading: false,
      currentTheme: 'light',
      fontSize: 100,
      toc: [],
      reset: vi.fn(),
      setToc: (toc) => useReaderStore.setState({ toc }),
      updateLocation: vi.fn(),
      setIsLoading: (isLoading) => useReaderStore.setState({ isLoading }),
      setCurrentBookId: (id) => useReaderStore.setState({ currentBookId: id }),
      viewMode: 'paginated', // Default for tests
      immersiveMode: true, // Needed for input controller to listen
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
      <MemoryRouter initialEntries={[`/read/${id}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
        useReaderStore.setState({ immersiveMode: false });
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
          useReaderStore.setState({ immersiveMode: false });
      });

      // Open Visual Settings (Theme, Font, etc.)
      const visualSettingsBtn = screen.getByLabelText('Visual Settings');
      fireEvent.click(visualSettingsBtn);

      // Change Theme
      const darkThemeBtn = await screen.findByLabelText('Select Dark theme');
      fireEvent.click(darkThemeBtn);

      expect(useReaderStore.getState().currentTheme).toBe('dark');

      // Toggle Force Theme
      // We use getByRole for switch as it might not be labeled by text directly in a way JSDOM likes with Radix
      const forceThemeSwitch = screen.getByRole('switch', { name: 'Force Theme' });
      fireEvent.click(forceThemeSwitch);

      expect(useReaderStore.getState().shouldForceFont).toBe(true);
  });
});
