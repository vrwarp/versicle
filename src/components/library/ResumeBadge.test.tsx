import { render, screen, act } from '@testing-library/react';
import { Profiler } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResumeBadge } from './ResumeBadge';
import { useReadingStateStore } from '@store/useReadingStateStore';
import { useDeviceStore } from '@store/useDeviceStore';
import type { DeviceInfo } from '~types/device';

// Mock getDeviceId to simulate current device
vi.mock('@lib/device-id', () => ({
  getDeviceId: () => 'device-1',
}));

vi.mock('@store/useReadingStateStore', () => ({
  useReadingStateStore: vi.fn(),
}));

const device = (id: string, name: string): DeviceInfo =>
  ({
    id,
    name,
    platform: 'macOS',
    browser: 'Chrome',
    model: null,
    userAgent: 'test',
    appVersion: '1.0.0',
    created: 1000,
    lastActive: 1000,
    profile: {
      theme: 'light',
      fontSize: 16,
      ttsVoiceURI: null,
      ttsRate: 1,
      ttsPitch: 1,
    },
  }) as DeviceInfo;

const ALL_PROGRESS = {
  'device-1': { percentage: 0.1, currentCfi: '/1', lastRead: 100 },
  'device-2': { percentage: 0.8, currentCfi: '/2', lastRead: 200 },
};

describe('ResumeBadge Performance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDeviceStore.setState({
      devices: {
        'device-2': device('device-2', 'Other Device'),
        'device-3': device('device-3', 'Unrelated Device'),
      },
    });
  });

  it('renders from passed allProgress prop without calling useReadingStateStore internally', () => {
    render(<ResumeBadge bookId="book-1" allProgress={ALL_PROGRESS} onResumeClick={vi.fn()} />);

    // Remote device-2 has more progress, so badge should appear

    expect(screen.getByText(/80%/)).toBeInTheDocument();
    expect(screen.getByTestId('resume-badge')).toHaveAttribute(
      'title',
      'Continue from Other Device at 80%',
    );

    // Verify useReadingStateStore was NOT called, confirming it relies on the prop
    expect(useReadingStateStore).not.toHaveBeenCalled();
  });

  /**
   * F5(b): the badge used to subscribe to the WHOLE `devices` map, so every
   * device write — including the rolling embed-spend publisher, which fires per
   * embedding request — re-rendered one badge per mounted book card. It renders
   * exactly two fields of ONE device; only those are subscribed now.
   */
  describe('regression: an unrelated device write does not re-render the badge', () => {
    const renderCounted = () => {
      let renders = 0;
      render(
        <Profiler
          id="resume-badge"
          onRender={() => {
            renders++;
          }}
        >
          <ResumeBadge bookId="book-1" allProgress={ALL_PROGRESS} onResumeClick={vi.fn()} />
        </Profiler>,
      );
      expect(renders).toBe(1);
      return {
        reset: () => {
          renders = 0;
        },
        count: () => renders,
      };
    };

    const patchDevice = (id: string, patch: Partial<DeviceInfo>) => {
      act(() => {
        useDeviceStore.setState((state) => ({
          devices: { ...state.devices, [id]: { ...state.devices[id], ...patch } },
        }));
      });
    };

    it('ignores another device being renamed, touched, or publishing embed spend', () => {
      const probe = renderCounted();
      probe.reset();

      patchDevice('device-3', { name: 'Renamed Sibling' });
      patchDevice('device-3', { lastActive: 999_999 });
      patchDevice('device-3', { embedSpend: { day: '2026-06-13', rpd: 120 } });

      expect(probe.count()).toBe(0);
    });

    it('ignores fields of the resolved device that it does not render', () => {
      const probe = renderCounted();
      probe.reset();

      patchDevice('device-2', { lastActive: 999_999 });
      patchDevice('device-2', { embedSpend: { day: '2026-06-13', rpd: 120 } });

      expect(probe.count()).toBe(0);
    });

    it('still re-renders when the resolved device renames', () => {
      const probe = renderCounted();
      probe.reset();

      patchDevice('device-2', { name: 'MacBook Air' });

      expect(probe.count()).toBe(1);
      expect(screen.getByTestId('resume-badge')).toHaveAttribute(
        'title',
        'Continue from MacBook Air at 80%',
      );
    });
  });
});
