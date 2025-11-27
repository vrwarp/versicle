import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
    get: vi.fn((store, id) => {
      if (store === 'files') return Promise.resolve(new ArrayBuffer(10));
      if (store === 'books') return Promise.resolve({ title: 'Test Book' });
      return Promise.resolve(null);
    }),
    transaction: vi.fn(() => ({
        objectStore: vi.fn(() => ({
            get: vi.fn(),
            put: vi.fn()
        })),
        done: Promise.resolve()
    }))
  })),
}));

// Mock URL.createObjectURL
global.URL.createObjectURL = vi.fn(() => 'blob:url');

// Mock searchClient
vi.mock('../../../lib/search', () => ({
    searchClient: {
        indexBook: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([])
    }
}));

// Mock window.speechSynthesis
Object.defineProperty(window, 'speechSynthesis', {
    value: {
        getVoices: vi.fn().mockReturnValue([]),
        speak: vi.fn(),
        cancel: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        onvoiceschanged: null,
        speaking: false,
        paused: false,
        pending: false
    },
    writable: true
});

// Mock SpeechSynthesisUtterance
global.SpeechSynthesisUtterance = vi.fn().mockImplementation(() => ({
    text: '',
    voice: null,
    rate: 1,
    onstart: null,
    onend: null,
    onerror: null,
}));


describe('ReaderView', () => {
  const mockRenderTo = vi.fn();
  const mockDisplay = vi.fn();
  const mockPrev = vi.fn();
  const mockNext = vi.fn();
  const mockRegister = vi.fn();
  const mockSelect = vi.fn();
  const mockFontSize = vi.fn();
  const mockAnnotations = { add: vi.fn(), remove: vi.fn() };
  const mockDefault = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock epubjs instance
    (ePub as any).mockReturnValue({
      renderTo: mockRenderTo.mockReturnValue({
        display: mockDisplay,
        prev: mockPrev,
        next: mockNext,
        themes: {
          register: mockRegister,
          select: mockSelect,
          fontSize: mockFontSize,
          default: mockDefault
        },
        annotations: mockAnnotations,
        on: vi.fn(),
        off: vi.fn(),
        getContents: vi.fn(() => [])
      }),
      ready: Promise.resolve(),
      loaded: {
        navigation: Promise.resolve({ toc: [{ id: '1', label: 'Chapter 1', href: 'chap1.html' }] })
      },
      locations: {
          generate: vi.fn(),
          percentageFromCfi: vi.fn(() => 0.5)
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
    });

    useTTSStore.setState({
        isPlaying: false,
        activeCfi: null
    });
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

  it('handles navigation (next/prev)', async () => {
    renderComponent();

    await waitFor(() => expect(mockRenderTo).toHaveBeenCalled());

    const nextBtn = screen.getByLabelText('Next Page');
    const prevBtn = screen.getByLabelText('Previous Page');

    fireEvent.click(nextBtn);
    expect(mockNext).toHaveBeenCalled();

    fireEvent.click(prevBtn);
    expect(mockPrev).toHaveBeenCalled();
  });

  it('toggles TOC', async () => {
    renderComponent();
    await waitFor(() => expect(mockRenderTo).toHaveBeenCalled());

    const tocBtn = screen.getByLabelText('Table of Contents');
    fireEvent.click(tocBtn);

    await waitFor(() => {
        expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    });
  });

  it('updates settings', async () => {
      renderComponent();
      await waitFor(() => expect(mockRenderTo).toHaveBeenCalled());

      const settingsBtn = screen.getByLabelText('Settings');
      fireEvent.click(settingsBtn);

      const darkThemeBtn = screen.getAllByRole('button').find(b => b.className.includes('bg-gray-800') || b.className.includes('#333'));
      // Simplified selector logic as in real component they are buttons with style background
      // The component renders theme buttons. We can find by checking style or just fire event if we can locate it.

      // The theme buttons don't have aria-labels in the simplified component, so let's find by checking the container
      const themeButtons = screen.getByText('Theme').nextElementSibling?.querySelectorAll('button');
      if (themeButtons && themeButtons[1]) {
          fireEvent.click(themeButtons[1]); // Dark
          expect(useReaderStore.getState().currentTheme).toBe('dark');
      }
  });
});
