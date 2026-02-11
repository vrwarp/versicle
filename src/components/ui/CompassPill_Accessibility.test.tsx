import React from 'react';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompassPill } from './CompassPill';
import { useTTSStore } from '../../store/useTTSStore';
import { useReaderUIStore } from '../../store/useReaderUIStore';
import { useSectionDuration } from '../../hooks/useSectionDuration';

// Mock the stores and hooks
vi.mock('../../store/useTTSStore');
vi.mock('../../store/useReaderUIStore');
vi.mock('../../hooks/useSectionDuration');

describe('CompassPill Accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    (useTTSStore as unknown as Mock).mockReturnValue({
      isPlaying: false,
      status: 'ready',
      queue: [],
      currentIndex: 0,
      play: vi.fn(),
      pause: vi.fn(),
    });

    (useReaderUIStore as unknown as Mock).mockReturnValue(''); // currentSectionTitle

    (useSectionDuration as unknown as Mock).mockReturnValue({
      timeRemaining: 5.5, // 5m 30s
      progress: 50,
    });
  });

  it('Active Mode: aria-label should be descriptive', () => {
    (useReaderUIStore as unknown as Mock).mockReturnValue('Chapter 1');

    render(
      <CompassPill
        variant="active"
        title="My Book"
        subtitle="Chapter 1"
      />
    );

    const toggleButton = screen.getByTestId('compass-active-toggle');

    expect(toggleButton).toHaveAttribute('aria-label', expect.stringContaining('Play Chapter 1'));
    expect(toggleButton).toHaveAttribute('aria-label', expect.stringContaining('5 minutes 30 seconds remaining'));
  });

  it('Summary Mode: aria-label should be descriptive', () => {
    render(
      <CompassPill
        variant="summary"
        title="My Book"
        subtitle="Chapter 5"
        progress={75}
      />
    );

    const container = screen.getByTestId('compass-pill-summary');
    expect(container).toHaveAttribute('aria-label', expect.stringContaining('Continue reading My Book'));
    expect(container).toHaveAttribute('aria-label', expect.stringContaining('Chapter 5'));
    expect(container).toHaveAttribute('aria-label', expect.stringContaining('75% complete'));
  });

  it('Active Mode: aria-label changes on loading', () => {
    (useTTSStore as unknown as Mock).mockReturnValue({
      isPlaying: false,
      status: 'loading',
      queue: [],
      currentIndex: 0,
      play: vi.fn(),
      pause: vi.fn(),
    });

    render(<CompassPill variant="active" />);
    const toggleButton = screen.getByTestId('compass-active-toggle');
    expect(toggleButton).toHaveAttribute('aria-label', 'Loading...');
  });

  it('Compact Mode: aria-label check', () => {
     render(<CompassPill variant="compact" title="Compact Book" />);

     // Now it should include the title
     const playButton = screen.getByLabelText('Play Compact Book');
     expect(playButton).toBeInTheDocument();
  });
});
