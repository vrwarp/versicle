import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AudioReaderHUD } from '../../../components/audio/AudioReaderHUD';
import { useTTSStore } from '../../../store/useTTSStore';
import { useReaderStore } from '../../../store/useReaderStore';

// Mock dependencies
vi.mock('../../../hooks/useChapterDuration', () => ({
  useChapterDuration: () => ({
    chapterRemaining: 0.111, // ~6.6 seconds
    bookRemaining: 10,
    totalBookDuration: 100
  })
}));

vi.mock('lucide-react', () => ({
  ChevronLeft: () => <span data-testid="chevron-left">Left</span>,
  ChevronRight: () => <span data-testid="chevron-right">Right</span>,
  Play: () => <span data-testid="icon-play">Play</span>,
  Pause: () => <span data-testid="icon-pause">Pause</span>,
}));

describe('AudioReaderHUD', () => {
  beforeEach(() => {
    // Reset store state
    useTTSStore.setState({
      queue: [],
      currentIndex: 0,
      isPlaying: false,
      rate: 1.0,
      jumpTo: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
    });
    useReaderStore.setState({
      currentChapterTitle: 'Chapter 1'
    });
  });

  it('should not render when queue is empty', () => {
    render(<AudioReaderHUD />);
    const container = screen.queryByText('Chapter 1');
    expect(container).toBeNull();
  });

  it('should render when queue has items', () => {
    useTTSStore.setState({
      queue: [{ text: 'Hello world', start: 0, end: 10, title: 'Chapter 1' }],
      currentIndex: 0,
    });

    render(<AudioReaderHUD />);
    expect(screen.getByText('Chapter 1')).toBeDefined();
    expect(screen.getByTestId('icon-play')).toBeDefined();
  });

  it('should toggle play/pause when FAB is clicked', async () => {
    const playMock = vi.fn();
    const pauseMock = vi.fn();

    useTTSStore.setState({
      queue: [{ text: 'Hello', start: 0, end: 5 }],
      isPlaying: false,
      play: playMock,
      pause: pauseMock,
    });

    render(<AudioReaderHUD />);
    const fab = screen.getByRole('button', { name: 'Play' }); // Aria label

    // Click to Play
    fireEvent.click(fab);
    expect(playMock).toHaveBeenCalled();

    // Set playing state
    useTTSStore.setState({ isPlaying: true });

    // Wait for the icon to switch to pause
    const pauseIcon = await screen.findByTestId('icon-pause');
    expect(pauseIcon).toBeDefined();

    // Click to Pause
    const pauseBtn = screen.getByRole('button', { name: 'Pause' });
    fireEvent.click(pauseBtn);
    expect(pauseMock).toHaveBeenCalled();
  });

  it('should navigate to next/prev', () => {
    const jumpToMock = vi.fn();
    useTTSStore.setState({
      queue: [
        { text: 'Sentence 1', start: 0, end: 10 },
        { text: 'Sentence 2', start: 10, end: 20 },
        { text: 'Sentence 3', start: 20, end: 30 },
      ],
      currentIndex: 1, // Middle
      jumpTo: jumpToMock,
    });

    render(<AudioReaderHUD />);

    // Find controls
    // We didn't put aria-labels on prev/next buttons in the implementation (just icons).
    // The implementation has:
    // Left Control: <button ...> <ChevronLeft /> </button>
    // Right Control: <button ...> <ChevronRight /> </button>
    // Let's assume buttons by order or add aria labels in implementation.

    // Using testid from mock
    const leftIcon = screen.getByTestId('chevron-left');
    const rightIcon = screen.getByTestId('chevron-right');
    const leftBtn = leftIcon.closest('button');
    const rightBtn = rightIcon.closest('button');

    // Click Prev
    fireEvent.click(leftBtn!);
    expect(jumpToMock).toHaveBeenCalledWith(0);

    // Click Next
    fireEvent.click(rightBtn!);
    expect(jumpToMock).toHaveBeenCalledWith(2);
  });

  it('should disable prev button at start of queue', () => {
    useTTSStore.setState({
      queue: [{ text: 'Start', start: 0, end: 5 }, { text: 'End', start: 5, end: 10 }],
      currentIndex: 0,
    });
    render(<AudioReaderHUD />);
    const leftIcon = screen.getByTestId('chevron-left');
    const leftBtn = leftIcon.closest('button');
    expect(leftBtn).toBeDisabled();
  });

  it('should disable next button at end of queue', () => {
    useTTSStore.setState({
      queue: [{ text: 'Start', start: 0, end: 5 }, { text: 'End', start: 5, end: 10 }],
      currentIndex: 1,
    });
    render(<AudioReaderHUD />);
    const rightIcon = screen.getByTestId('chevron-right');
    const rightBtn = rightIcon.closest('button');
    expect(rightBtn).toBeDisabled();
  });

  it('should display correct remaining time', () => {
    // 2 sentences, 50 chars each = 100 chars
    // 100 chars / 5 = 20 words
    // 20 words / (180 * 1.0) = 0.111 minutes = 6.66 seconds
    useTTSStore.setState({
      queue: [
        { text: 'A'.repeat(50), start: 0, end: 50 },
        { text: 'B'.repeat(50), start: 50, end: 100 },
      ],
      currentIndex: 0,
      rate: 1.0,
    });

    render(<AudioReaderHUD />);
    // 6 seconds. Format: -0:06 remaining
    expect(screen.getByText(/-0:06 remaining/)).toBeDefined();
  });
});
