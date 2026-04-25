/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSectionDuration } from './useSectionDuration';
import { useTTSStore } from '../store/useTTSStore';
import { useReaderUIStore } from '../store/useReaderUIStore';
import { useBookStore } from '../store/useBookStore';

vi.mock('../store/useTTSStore');
vi.mock('../store/useReaderUIStore');
vi.mock('../store/useBookStore');

describe('useSectionDuration', () => {
    let mockState: any;
    let mockReaderUIState: any;
    let mockBookState: any;

    beforeEach(() => {
        mockState = {
            queue: [],
            currentIndex: 0,
            rate: 1.0
        };
        (useTTSStore as any).mockImplementation((selector: any) => selector(mockState));

        mockReaderUIState = {
            currentBookId: 'test-book-id'
        };
        (useReaderUIStore as any).mockImplementation((selector: any) => selector(mockReaderUIState));

        mockBookState = {
            books: {
                'test-book-id': {}
            }
        };
        (useBookStore as any).mockImplementation((selector: any) => selector(mockBookState));
    });

    it('should return 0 if queue is empty', () => {
        mockState.queue = [];
        const { result } = renderHook(() => useSectionDuration());
        expect(result.current).toEqual({ timeRemaining: 0, progress: 0 });
    });

    it('should calculate time remaining', () => {
         // Queue with 900 chars (1 min at 1.0 rate)
         const text = 'a'.repeat(900);
         mockState.queue = [{ text }];
         mockState.currentIndex = 0;

         const { result } = renderHook(() => useSectionDuration());
         expect(result.current.timeRemaining).toBeCloseTo(1.0);
         expect(result.current.progress).toBe(0);
    });

    it('should handle progress correctly', () => {
         mockState.queue = [{ text: 'a' }, { text: 'b' }];
         mockState.currentIndex = 1;

         const { result } = renderHook(() => useSectionDuration());
         expect(result.current.progress).toBe(50);
    });

    it('Metadata Dominance: should use 300 CPM if language is zh', () => {
         mockBookState.books['test-book-id'].language = 'zh';
         // 300 chars should take 1 min
         const text = 'a'.repeat(300);
         mockState.queue = [{ text }];
         mockState.currentIndex = 0;

         const { result } = renderHook(() => useSectionDuration());
         expect(result.current.timeRemaining).toBeCloseTo(1.0);
    });

    it('Metadata Dominance (Override): should use 900 CPM if language is en, even with CJK chars', () => {
         mockBookState.books['test-book-id'].language = 'en';
         // 900 chars of CJK should take 1 min
         const text = '你'.repeat(900);
         mockState.queue = [{ text }];
         mockState.currentIndex = 0;

         const { result } = renderHook(() => useSectionDuration());
         expect(result.current.timeRemaining).toBeCloseTo(1.0);
    });

    it('JIT Fallback: should use 300 CPM if language is undefined and queue has CJK', () => {
         mockBookState.books['test-book-id'].language = undefined;
         // 300 CJK chars should take 1 min
         const text = '你好'.repeat(150); // 300 chars
         mockState.queue = [{ text }];
         mockState.currentIndex = 0;

         const { result } = renderHook(() => useSectionDuration());
         expect(result.current.timeRemaining).toBeCloseTo(1.0);
    });

    it('Default Behavior: should use 900 CPM if language is undefined and queue is Latin', () => {
         mockBookState.books['test-book-id'].language = undefined;
         // 900 Latin chars should take 1 min
         const text = 'Hello world'.repeat(81) + 'Hellowo'; // 900 chars approx
         mockState.queue = [{ text: text.substring(0, 900) }];
         mockState.currentIndex = 0;

         const { result } = renderHook(() => useSectionDuration());
         expect(result.current.timeRemaining).toBeCloseTo(1.0);
    });

    it('Rate Scaling: rate 2.0 should halve the time remaining', () => {
         mockBookState.books['test-book-id'].language = 'zh';
         const text = 'a'.repeat(300); // 1 min at 1.0 rate
         mockState.queue = [{ text }];
         mockState.currentIndex = 0;
         mockState.rate = 2.0;

         const { result } = renderHook(() => useSectionDuration());
         expect(result.current.timeRemaining).toBeCloseTo(0.5);
    });
});
