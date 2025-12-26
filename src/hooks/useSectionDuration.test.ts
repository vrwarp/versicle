/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSectionDuration } from './useSectionDuration';
import { useTTSStore } from '../store/useTTSStore';

vi.mock('../store/useTTSStore');

describe('useSectionDuration', () => {
    let mockState: any;

    beforeEach(() => {
        mockState = {
            queue: [],
            currentIndex: 0,
            rate: 1.0
        };
        (useTTSStore as any).mockImplementation((selector: any) => selector(mockState));
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
});
