/**
 * useSyncToasts — remote-progress toast announcements (P9: rewritten from
 * the whole-map JSON.stringify subscription onto zustand's (state,
 * prevState) reference diffing; this suite is its first behavior pin).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { useSyncToasts } from './useSyncToasts';
import { useReadingStateStore } from '@store/useReadingStateStore';
import { useToastStore } from '@store/useToastStore';
import { useBookStore } from '@store/useBookStore';

vi.mock('@lib/device-id', () => ({
  getDeviceId: () => 'this-device',
}));

function setProgress(bookId: string, deviceId: string, percentage: number, lastRead: number) {
  act(() => {
    const prev = useReadingStateStore.getState().progress;
    useReadingStateStore.setState({
      progress: {
        ...prev,
        [bookId]: {
          ...prev[bookId],
          [deviceId]: { percentage, lastRead } as never,
        },
      },
    });
  });
}

describe('useSyncToasts (remote progress announcements)', () => {
  let toasts: string[];

  beforeEach(() => {
    toasts = [];
    useReadingStateStore.setState({ progress: {} });
    useBookStore.setState({
      books: { 'book-1': { bookId: 'book-1', title: 'Moby Dick' } as never },
    });
    useToastStore.setState({
      showToast: ((message: string) => {
        toasts.push(String(message));
      }) as never,
    });
  });

  it('announces a significant remote progress jump with the book title', () => {
    // Baseline exists pre-mount (hydration completes before the hook mounts).
    setProgress('book-1', 'other-device', 0.1, 1000);
    renderHook(() => useSyncToasts());
    setProgress('book-1', 'other-device', 0.5, 2000);

    expect(toasts).toHaveLength(1);
    expect(toasts.some((t) => t.includes('Moby Dick') && t.includes('another device'))).toBe(true);
  });

  it('ignores updates from THIS device', () => {
    renderHook(() => useSyncToasts());
    setProgress('book-1', 'this-device', 0.1, 1000);
    setProgress('book-1', 'this-device', 0.9, 2000);
    expect(toasts).toHaveLength(0);
  });

  it('ignores insignificant (<5%) remote deltas', () => {
    setProgress('book-1', 'other-device', 0.1, 1000);
    renderHook(() => useSyncToasts());
    setProgress('book-1', 'other-device', 0.12, 2000);
    expect(toasts).toHaveLength(0);
  });

  it('announces remote completion', () => {
    setProgress('book-1', 'other-device', 0.97, 1000);
    renderHook(() => useSyncToasts());
    setProgress('book-1', 'other-device', 0.99, 2000);
    expect(toasts.some((t) => t.includes('Finished reading'))).toBe(true);
  });

  it('throttles to one toast per book per minute', () => {
    setProgress('book-1', 'other-device', 0.1, 1000);
    renderHook(() => useSyncToasts());
    setProgress('book-1', 'other-device', 0.3, 2000);
    setProgress('book-1', 'other-device', 0.6, 3000);
    expect(toasts).toHaveLength(1);
  });

  it('unrelated store changes never run the diff (reference short-circuit)', () => {
    renderHook(() => useSyncToasts());
    const progressBefore = useReadingStateStore.getState().progress;
    act(() => {
      // A write that does not touch `progress` keeps the same reference.
      useReadingStateStore.setState({});
    });
    expect(useReadingStateStore.getState().progress).toBe(progressBefore);
    expect(toasts).toHaveLength(0);
  });
});
