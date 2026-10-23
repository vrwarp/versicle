import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LiveAnnouncer } from './LiveAnnouncer';
import { announce } from '@kernel/locale/announcer';

describe('LiveAnnouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const flushFrame = () => act(() => { vi.advanceTimersByTime(20); });

  it('injects polite text into the status region and assertive text into the alert region', () => {
    render(<LiveAnnouncer />);
    act(() => { announce('polite one'); });
    act(() => { announce('assertive one', { assertive: true }); });
    flushFrame();
    expect(screen.getByTestId('live-announcer-polite')).toHaveTextContent('polite one');
    expect(screen.getByTestId('live-announcer-assertive')).toHaveTextContent('assertive one');
  });

  it('empties a region after the stale-text delay', () => {
    render(<LiveAnnouncer />);
    act(() => { announce('hello'); });
    flushFrame();
    expect(screen.getByTestId('live-announcer-polite')).toHaveTextContent('hello');
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByTestId('live-announcer-polite')).toHaveTextContent('');
  });

  describe('regression: regions shared one frame/timer handle', () => {
    it('does not drop a polite announcement made in the same frame as an assertive one', () => {
      render(<LiveAnnouncer />);
      act(() => {
        announce('quiet');
        announce('loud', { assertive: true });
      });
      flushFrame();
      expect(screen.getByTestId('live-announcer-polite')).toHaveTextContent('quiet');
      expect(screen.getByTestId('live-announcer-assertive')).toHaveTextContent('loud');
    });

    it('still empties the polite region when an assertive announcement follows it', () => {
      render(<LiveAnnouncer />);
      act(() => { announce('quiet'); });
      flushFrame();
      act(() => { vi.advanceTimersByTime(1_000); });
      act(() => { announce('loud', { assertive: true }); });
      flushFrame();
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(screen.getByTestId('live-announcer-polite')).toHaveTextContent('');
      expect(screen.getByTestId('live-announcer-assertive')).toHaveTextContent('');
    });
  });
});
