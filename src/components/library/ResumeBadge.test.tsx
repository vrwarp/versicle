import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResumeBadge } from './ResumeBadge';
import { useReadingStateStore } from '../../store/useReadingStateStore';

// Mock getDeviceId to simulate current device
vi.mock('../../lib/device-id', () => ({
  getDeviceId: () => 'device-1',
}));

vi.mock('../../store/useReadingStateStore', () => ({
  useReadingStateStore: vi.fn(),
}));

vi.mock('../../store/useDeviceStore', () => ({
  useDeviceStore: vi.fn((selector) => {
    // Return a dummy devices object for selector
    if (selector) return selector({ devices: { 'device-2': { id: 'device-2', name: 'Other Device' } } });
    return { devices: { 'device-2': { id: 'device-2', name: 'Other Device' } } };
  }),
}));

describe('ResumeBadge Performance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders from passed allProgress prop without calling useReadingStateStore internally', () => {
    const allProgress = {
      'device-1': { percentage: 0.1, currentCfi: '/1', lastRead: 100 },
      'device-2': { percentage: 0.8, currentCfi: '/2', lastRead: 200 },
    };

    render(<ResumeBadge bookId="book-1" allProgress={allProgress} onResumeClick={vi.fn()} />);

    // Remote device-2 has more progress, so badge should appear

    expect(screen.getByText(/80%/)).toBeInTheDocument();

    // Verify useReadingStateStore was NOT called, confirming it relies on the prop
    expect(useReadingStateStore).not.toHaveBeenCalled();
  });
});
