/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useChapterDuration } from './useChapterDuration';
import { useTTSStore } from '../store/useTTSStore';
import { useReaderStore } from '../store/useReaderStore';
import { getDB } from '../db/db';

// Mock dependencies
vi.mock('../store/useTTSStore');
vi.mock('../store/useReaderStore');
vi.mock('../db/db', () => ({
  getDB: vi.fn(),
}));

describe('useChapterDuration', () => {
  const mockDB = {
    get: vi.fn(),
    getAllFromIndex: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getDB as any).mockResolvedValue(mockDB);
    (useTTSStore as any).mockReturnValue({
        queue: [],
        currentIndex: 0,
        rate: 1.0
    });
    (useReaderStore as any).mockReturnValue({
        currentBookId: 'book-1',
        currentSectionId: 'section-1'
    });
  });

  afterEach(() => {
      vi.resetAllMocks();
  });

  it('should return nulls if currentBookId is missing', async () => {
    (useReaderStore as any).mockReturnValue({
        currentBookId: null,
        currentSectionId: null
    });

    const { result } = renderHook(() => useChapterDuration());

    await waitFor(() => {
        expect(result.current).toEqual({
            chapterRemaining: null,
            bookRemaining: null,
            totalBookDuration: null,
        });
    });
  });

  it('should calculate durations correctly', async () => {
     mockDB.get.mockResolvedValue({
         id: 'book-1',
         totalChars: 9000 // 10 mins at 900 chars/min (180 wpm * 5 chars/word)
     });

     mockDB.getAllFromIndex.mockResolvedValue([
         { sectionId: 'section-1', characterCount: 900, playOrder: 0 }, // 1 min
         { sectionId: 'section-2', characterCount: 1800, playOrder: 1 }, // 2 mins
         { sectionId: 'section-3', characterCount: 6300, playOrder: 2 }, // 7 mins
     ]);

     const { result } = renderHook(() => useChapterDuration());

     await waitFor(() => {
         expect(result.current.totalBookDuration).toBe(10); // 9000 / 900
         expect(result.current.chapterRemaining).toBe(1); // 900 / 900
         // Book remaining = current chapter (1) + future chapters (2 + 7) = 10
         expect(result.current.bookRemaining).toBe(10);
     });
  });

  it('should calculate remaining correctly when current section is in the middle', async () => {
      (useReaderStore as any).mockReturnValue({
        currentBookId: 'book-1',
        currentSectionId: 'section-2'
      });

      mockDB.get.mockResolvedValue({
         id: 'book-1',
         totalChars: 9000
      });

      mockDB.getAllFromIndex.mockResolvedValue([
         { sectionId: 'section-1', characterCount: 900, playOrder: 0 },
         { sectionId: 'section-2', characterCount: 1800, playOrder: 1 }, // 2 mins
         { sectionId: 'section-3', characterCount: 6300, playOrder: 2 }, // 7 mins
      ]);

      const { result } = renderHook(() => useChapterDuration());

      await waitFor(() => {
         expect(result.current.chapterRemaining).toBe(2);
         // Book remaining = current (2) + future (7) = 9
         expect(result.current.bookRemaining).toBe(9);
      });
  });

  it('should use TTS queue for high precision chapter remaining', async () => {
     (useTTSStore as any).mockReturnValue({
        queue: [
            { text: 'A' }, // length 1
            { text: 'B' }, // length 1
            { text: 'C' }  // length 1
        ],
        currentIndex: 1, // 'B' is current
        rate: 1.0
     });

     // Queue remaining: 'B' + 'C' = 2 chars
     // 2 chars / 900 chars/min = 0.00222 mins

     mockDB.get.mockResolvedValue({
         id: 'book-1',
         totalChars: 9000
     });

     mockDB.getAllFromIndex.mockResolvedValue([
         { sectionId: 'section-1', characterCount: 900, playOrder: 0 },
     ]);

     const { result } = renderHook(() => useChapterDuration());

     await waitFor(() => {
         const expectedChapterDuration = 2 / 900;
         expect(result.current.chapterRemaining).toBeCloseTo(expectedChapterDuration);
     });
  });

  it('should adjust for playback rate', async () => {
      (useTTSStore as any).mockReturnValue({
        queue: [],
        currentIndex: 0,
        rate: 2.0 // 2x speed -> 1800 chars/min
      });

     mockDB.get.mockResolvedValue({
         id: 'book-1',
         totalChars: 9000 // 5 mins at 2x speed
     });

     mockDB.getAllFromIndex.mockResolvedValue([
         { sectionId: 'section-1', characterCount: 1800, playOrder: 0 }, // 1 min at 2x
     ]);

     const { result } = renderHook(() => useChapterDuration());

     await waitFor(() => {
         expect(result.current.totalBookDuration).toBe(5);
         expect(result.current.chapterRemaining).toBe(1);
     });
  });
});
