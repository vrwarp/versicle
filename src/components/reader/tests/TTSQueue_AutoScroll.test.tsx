import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TTSQueue } from '../TTSQueue';
import { useTTSStore } from '../../../store/useTTSStore';

// Mock the store
vi.mock('../../../store/useTTSStore', () => ({
  useTTSStore: vi.fn(),
}));

// Mock scrollIntoView
const scrollIntoViewMock = vi.fn();
window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

// Mock getBoundingClientRect
let mockRects: Record<string, { top: number; bottom: number }> = {};
const CONTAINER_RECT = { top: 0, bottom: 100 };

beforeEach(() => {
  vi.clearAllMocks();
  mockRects = {};
  scrollIntoViewMock.mockClear();

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const testId = this.getAttribute('data-testid');
    if (testId === 'tts-queue-list') {
        return { ...CONTAINER_RECT, height: 100, width: 100, left: 0, right: 100, x: 0, y: 0, toJSON: () => {} } as DOMRect;
    }
    if (testId && mockRects[testId]) {
      return {
        ...mockRects[testId],
        height: mockRects[testId].bottom - mockRects[testId].top,
        width: 100,
        left: 0,
        right: 100,
        x: 0,
        y: mockRects[testId].top,
        toJSON: () => {},
      } as DOMRect;
    }
    return { top: 1000, bottom: 1010, height: 10, width: 100, left: 0, right: 100, x: 0, y: 1000, toJSON: () => {} } as DOMRect;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TTSQueue Auto-Scroll', () => {
  // Stable queue reference to avoid unwanted useEffect triggers in component
  const queue = Array(11).fill(null).map((_, i) => ({ text: `Line ${i}`, cfi: `${i}` }));

  it('scrolls when active item is visible', () => {
    mockRects['tts-queue-item-0'] = { top: 0, bottom: 10 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useTTSStore as any).mockReturnValue({
      queue,
      currentIndex: 0,
      jumpTo: vi.fn(),
    });

    render(<TTSQueue />);
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it('scrolls when previous active item was visible (following playback)', () => {
    mockRects['tts-queue-item-0'] = { top: 0, bottom: 10 };
    mockRects['tts-queue-item-1'] = { top: 110, bottom: 120 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockStore = (useTTSStore as any);
    mockStore.mockReturnValue({
      queue,
      currentIndex: 0,
      jumpTo: vi.fn(),
    });

    const { rerender } = render(<TTSQueue />);
    scrollIntoViewMock.mockClear();

    mockStore.mockReturnValue({
        queue, // Same ref
        currentIndex: 1,
        jumpTo: vi.fn(),
    });

    rerender(<TTSQueue />);
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it('does NOT scroll when previous active item was NOT visible (scrolled away)', () => {
    mockRects['tts-queue-item-0'] = { top: -200, bottom: -190 };
    mockRects['tts-queue-item-1'] = { top: -180, bottom: -170 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockStore = (useTTSStore as any);
    mockStore.mockReturnValue({
      queue,
      currentIndex: 0,
      jumpTo: vi.fn(),
    });

    const { rerender } = render(<TTSQueue />);
    scrollIntoViewMock.mockClear();

    mockStore.mockReturnValue({
        queue,
        currentIndex: 1,
        jumpTo: vi.fn(),
    });

    rerender(<TTSQueue />);
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('does NOT scroll when jumping to a non-visible item without previous context', () => {
    mockRects['tts-queue-item-0'] = { top: -200, bottom: -190 };
    mockRects['tts-queue-item-10'] = { top: 200, bottom: 210 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockStore = (useTTSStore as any);
    mockStore.mockReturnValue({
      queue, // Same ref
      currentIndex: 0,
      jumpTo: vi.fn(),
    });

    const { rerender } = render(<TTSQueue />);
    scrollIntoViewMock.mockClear();

    mockStore.mockReturnValue({
        queue, // Same ref
        currentIndex: 10,
        jumpTo: vi.fn(),
    });

    rerender(<TTSQueue />);
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('Always scrolls on initial mount (index 0)', () => {
    mockRects['tts-queue-item-0'] = { top: 0, bottom: 10 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useTTSStore as any).mockReturnValue({
      queue,
      currentIndex: 0,
      jumpTo: vi.fn(),
    });

    render(<TTSQueue />);
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it('Always scrolls when index resets to 0 (new chapter)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockStore = (useTTSStore as any);

    // Start at end of previous queue
    mockStore.mockReturnValue({
      queue: queue,
      currentIndex: 10,
      jumpTo: vi.fn(),
    });

    const { rerender } = render(<TTSQueue />);
    scrollIntoViewMock.mockClear();

    // Change to new queue (new ref), index 0
    const newQueue = Array(5).fill(null).map((_, i) => ({ text: `New Line ${i}`, cfi: `${i}` }));
    mockStore.mockReturnValue({
      queue: newQueue,
      currentIndex: 0,
      jumpTo: vi.fn(),
    });

    rerender(<TTSQueue />);
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });
});
