import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { GestureOverlay } from '../GestureOverlay';
import { useReaderStore } from '../../../store/useReaderStore';
import { useTTSStore } from '../../../store/useTTSStore';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../../../store/useReaderStore');
vi.mock('../../../store/useTTSStore');
vi.mock('lucide-react', () => ({
  Play: () => <div data-testid="icon-play">Play</div>,
  Pause: () => <div data-testid="icon-pause">Pause</div>,
  RotateCcw: () => <div data-testid="icon-rewind">Rewind</div>,
  RotateCw: () => <div data-testid="icon-forward">Forward</div>,
  Volume1: () => <div data-testid="icon-slower">Slower</div>,
  Volume2: () => <div data-testid="icon-faster">Faster</div>,
  ChevronLeft: () => <div data-testid="icon-prev">Prev</div>,
  ChevronRight: () => <div data-testid="icon-next">Next</div>,
  X: () => <div data-testid="icon-close">Close</div>,
  Rewind: () => <div data-testid="icon-rewind">Rewind</div>,
  FastForward: () => <div data-testid="icon-forward">Forward</div>,
}));

describe('GestureOverlay', () => {
  const mockPlay = vi.fn();
  const mockPause = vi.fn();
  const mockSeek = vi.fn();
  const mockSetRate = vi.fn();
  const mockClose = vi.fn();
  const mockNext = vi.fn();
  const mockPrev = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useReaderStore as any).mockReturnValue({
      gestureMode: true
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useTTSStore as any).mockReturnValue({
      isPlaying: false,
      play: mockPlay,
      pause: mockPause,
      seek: mockSeek,
      rate: 1.0,
      setRate: mockSetRate,
      providerId: 'cloud'
    });
    // Set window dimensions for tap zones
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1000 });

    // Mock Pointer Capture methods which are missing in JSDOM
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it('renders nothing when gestureMode is false', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useReaderStore as any).mockReturnValue({ gestureMode: false });
    render(<GestureOverlay onClose={mockClose} />);
    expect(screen.queryByText('Gesture Mode Active')).not.toBeInTheDocument();
  });

  it('renders overlay when gestureMode is true', () => {
    render(<GestureOverlay onClose={mockClose} />);
    expect(screen.getByText('Gesture Mode Active')).toBeInTheDocument();
  });

  it('handles center tap (Play/Pause)', () => {
    render(<GestureOverlay onClose={mockClose} />);
    const overlay = screen.getByText('Gesture Mode Active').parentElement!;

    // Simulate center tap
    fireEvent.pointerDown(overlay, { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 500, clientY: 500, pointerId: 1 });

    expect(mockPlay).toHaveBeenCalled();

    // Check feedback
    expect(screen.getByTestId('icon-play')).toBeInTheDocument();
  });

  it('handles left tap (Rewind)', () => {
    render(<GestureOverlay onClose={mockClose} />);
    const overlay = screen.getByText('Gesture Mode Active').parentElement!;

    // Simulate left tap (< 250px)
    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 100, clientY: 500, pointerId: 1 });

    expect(mockSeek).toHaveBeenCalledWith(-15);
    expect(screen.getByTestId('icon-rewind')).toBeInTheDocument();
  });

  it('handles right tap (Forward)', () => {
    render(<GestureOverlay onClose={mockClose} />);
    const overlay = screen.getByText('Gesture Mode Active').parentElement!;

    // Simulate right tap (> 750px)
    fireEvent.pointerDown(overlay, { clientX: 900, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 900, clientY: 500, pointerId: 1 });

    expect(mockSeek).toHaveBeenCalledWith(15);
    expect(screen.getByTestId('icon-forward')).toBeInTheDocument();
  });

  it('handles swipe up (Speed Up)', () => {
    render(<GestureOverlay onClose={mockClose} />);
    const overlay = screen.getByText('Gesture Mode Active').parentElement!;

    fireEvent.pointerDown(overlay, { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 500, clientY: 400, pointerId: 1 }); // 100px up

    expect(mockSetRate).toHaveBeenCalledWith(1.1);
    expect(screen.getByTestId('icon-faster')).toBeInTheDocument();
  });

  it('handles swipe down (Speed Down)', () => {
    render(<GestureOverlay onClose={mockClose} />);
    const overlay = screen.getByText('Gesture Mode Active').parentElement!;

    fireEvent.pointerDown(overlay, { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 500, clientY: 600, pointerId: 1 }); // 100px down

    expect(mockSetRate).toHaveBeenCalledWith(0.9);
    expect(screen.getByTestId('icon-slower')).toBeInTheDocument();
  });

  it('handles swipe left (Next Chapter)', () => {
    render(<GestureOverlay onNextChapter={mockNext} onClose={mockClose} />);
    const overlay = screen.getByText('Gesture Mode Active').parentElement!;

    fireEvent.pointerDown(overlay, { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 400, clientY: 500, pointerId: 1 }); // 100px left (dx = -100)

    expect(mockNext).toHaveBeenCalled();
    expect(screen.getByTestId('icon-next')).toBeInTheDocument();
  });

   it('handles swipe right (Prev Chapter)', () => {
    render(<GestureOverlay onPrevChapter={mockPrev} onClose={mockClose} />);
    const overlay = screen.getByText('Gesture Mode Active').parentElement!;

    fireEvent.pointerDown(overlay, { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 600, clientY: 500, pointerId: 1 }); // 100px right (dx = 100)

    expect(mockPrev).toHaveBeenCalled();
    expect(screen.getByTestId('icon-prev')).toBeInTheDocument();
  });
});
