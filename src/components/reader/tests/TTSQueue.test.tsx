import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TTSQueue } from '../TTSQueue';
import { useTTSStore } from '../../../store/useTTSStore';

// Mock the store
vi.mock('../../../store/useTTSStore', () => ({
  useTTSStore: vi.fn(),
}));

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

describe('TTSQueue', () => {
  it('renders "No text available" when queue is empty', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useTTSStore as any).mockReturnValue({
      queue: [],
      currentIndex: 0,
      jumpTo: vi.fn(),
    });

    render(<TTSQueue />);
    expect(screen.getByText('No text available.')).toBeInTheDocument();
  });

  it('renders queue items correctly', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useTTSStore as any).mockReturnValue({
      queue: [
        { text: 'First sentence', cfi: 'cfi1' },
        { text: 'Second sentence', cfi: 'cfi2' },
      ],
      currentIndex: 0,
      jumpTo: vi.fn(),
    });

    render(<TTSQueue />);
    expect(screen.getByText('First sentence')).toBeInTheDocument();
    expect(screen.getByText('Second sentence')).toBeInTheDocument();
  });

  it('highlights active item', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useTTSStore as any).mockReturnValue({
      queue: [
        { text: 'First sentence', cfi: 'cfi1' },
        { text: 'Second sentence', cfi: 'cfi2' },
      ],
      currentIndex: 1,
      jumpTo: vi.fn(),
    });

    render(<TTSQueue />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[1].className).toContain('bg-primary/20');
    expect(buttons[0].className).toContain('opacity-60');
  });
});
