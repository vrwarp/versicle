import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReaderView } from '../ReaderView';
import { useReaderStore } from '../../../store/useReaderStore';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as db from '../../../db/db';

// Mock epub.js
const mockRendition = {
  themes: {
    register: vi.fn(),
    select: vi.fn(),
    fontSize: vi.fn(),
  },
  display: vi.fn().mockResolvedValue(undefined),
  next: vi.fn(),
  prev: vi.fn(),
  on: vi.fn(),
  destroy: vi.fn(),
};

const mockBook = {
  renderTo: vi.fn().mockReturnValue(mockRendition),
  ready: Promise.resolve(),
  loaded: {
    navigation: Promise.resolve({ toc: [{ id: '1', label: 'Chapter 1', href: 'chapter1.html' }] }),
  },
  destroy: vi.fn(),
  locations: {
    generate: vi.fn(),
    percentageFromCfi: vi.fn().mockReturnValue(0.1),
  },
  spine: {
      get: vi.fn().mockReturnValue({ label: 'Chapter 1' })
  }
};

vi.mock('epubjs', () => ({
  default: vi.fn(() => mockBook),
}));

// Mock DB
vi.mock('../../../db/db', () => ({
  getDB: vi.fn(),
}));

describe('ReaderView', () => {
  const bookId = 'test-book-id';

  beforeEach(() => {
    vi.clearAllMocks();
    useReaderStore.getState().reset();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.getDB as any).mockResolvedValue({
      get: vi.fn().mockImplementation((store, id) => {
        if (store === 'files') return new ArrayBuffer(10);
        if (store === 'books') return { id, title: 'Test Book', currentCfi: 'epubcfi(/6/2!/4/2)' };
        return null;
      }),
      transaction: vi.fn().mockReturnValue({
          objectStore: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({}),
              put: vi.fn().mockResolvedValue(undefined)
          }),
          done: Promise.resolve()
      })
    });
  });

  const renderReader = () => {
    return render(
      <MemoryRouter initialEntries={[`/read/${bookId}`]}>
        <Routes>
          <Route path="/read/:id" element={<ReaderView />} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('initializes epub.js and renders book', async () => {
    renderReader();

    expect(useReaderStore.getState().isLoading).toBe(true);

    await waitFor(() => {
        expect(mockBook.renderTo).toHaveBeenCalled();
    });

    expect(mockRendition.display).toHaveBeenCalledWith('epubcfi(/6/2!/4/2)');
    expect(useReaderStore.getState().isLoading).toBe(false);
  });

  it('handles navigation (next/prev)', async () => {
    renderReader();
    await waitFor(() => expect(mockBook.renderTo).toHaveBeenCalled());

    const nextBtn = screen.getByLabelText('Next Page');
    fireEvent.click(nextBtn);
    expect(mockRendition.next).toHaveBeenCalled();

    const prevBtn = screen.getByLabelText('Previous Page');
    fireEvent.click(prevBtn);
    expect(mockRendition.prev).toHaveBeenCalled();

    // Keyboard navigation
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(mockRendition.next).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(mockRendition.prev).toHaveBeenCalledTimes(2);
  });

  it('toggles TOC', async () => {
    renderReader();
    await waitFor(() => expect(mockBook.renderTo).toHaveBeenCalled());

    const tocButton = screen.getByLabelText('Table of Contents');
    fireEvent.click(tocButton);

    const chapterLink = screen.getByText('Chapter 1');
    expect(chapterLink).toBeInTheDocument();

    fireEvent.click(chapterLink);
    expect(mockRendition.display).toHaveBeenCalledWith('chapter1.html');
  });

  it('updates settings', async () => {
    renderReader();
    await waitFor(() => expect(mockBook.renderTo).toHaveBeenCalled());

    const settingsButton = screen.getByLabelText('Settings');
    fireEvent.click(settingsButton);

    const increaseFontButton = screen.getByText('+');
    fireEvent.click(increaseFontButton);

    // Initial is 100, so it should be 110 now
    expect(useReaderStore.getState().fontSize).toBe(110);
  });
});
