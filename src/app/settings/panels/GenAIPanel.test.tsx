/**
 * GenAIPanel quota-meters test (A7, §10.7 — the executable "meter can't drift"
 * check at the WIRED layer). Seeds useGenAIStore with a getQuotaSnapshot
 * returning a KNOWN LaneUsage and useDeviceStore.devices with one heartbeat-
 * active sibling carrying embedSpend stamped today, then asserts every rendered
 * meter (bar aria-valuenow + today-spend total + ETA) is derived from the
 * seeded snapshot plus the A6 cross-device sum — not fabricated.
 */
import { screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderWithStores, storeSeed } from '@test/harness';
import { useGenAIStore } from '@store/useGenAIStore';
import { useDeviceStore } from '@store/useDeviceStore';
import { getDeviceId } from '@lib/device-id';
import type { DeviceInfo, DeviceProfile } from '~types/device';
import type { LaneUsage } from '@kernel/quota';
import GenAIPanel from './GenAIPanel';

/** Midnight-PT day key — MUST match the reconciler so the sibling stamp counts. */
function ptDayString(epochMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const PROFILE: DeviceProfile = {
  theme: 'light',
  fontSize: 16,
  ttsVoiceURI: null,
  ttsRate: 1,
  ttsPitch: 1,
};

// Seeded snapshot: fg.rpm 40/100, fg.rpd 300/1000, bg.rpd 300/1000.
const SEEDED_SNAPSHOT: Record<'fg' | 'bg', LaneUsage> = {
  fg: { rpm: 40, tpm: 12000, rpd: 300, limits: { rpm: 100, tpm: 30000, rpd: 1000 } },
  bg: { rpm: 8, tpm: 4000, rpd: 300, limits: { rpm: 100, tpm: 30000, rpd: 1000 } },
};

function makeSibling(now: number): DeviceInfo {
  return {
    id: 'device-sibling',
    name: 'Sibling',
    platform: 'iOS',
    browser: 'Safari',
    model: 'iPhone',
    userAgent: 'test',
    appVersion: '1.0.0',
    lastActive: now, // heartbeat-active (within the 10-min window)
    created: now,
    profile: PROFILE,
    embedSpend: { day: ptDayString(now), rpd: 200, tpm: 0 }, // stamped today
  };
}

describe('GenAIPanel quota meters (wired §10.7)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderPanel = () => {
    const now = Date.now();
    return renderWithStores(<GenAIPanel />, {
      seeds: [
        storeSeed(useGenAIStore, {
          isEnabled: true,
          getQuotaSnapshot: () => SEEDED_SNAPSHOT,
        }),
        storeSeed(useDeviceStore, {
          devices: {
            [getDeviceId()]: { ...makeSibling(now), id: getDeviceId(), name: 'Self', embedSpend: undefined },
            'device-sibling': makeSibling(now),
          },
        }),
      ],
    });
  };

  it('renders meter bars whose aria-valuenow derives from the seeded snapshot', () => {
    renderPanel();
    // Flush the immediate poll tick scheduled inside useEffect.
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    const rpmBar = screen.getByRole('progressbar', { name: 'Foreground RPM usage' });
    expect(rpmBar).toHaveAttribute('aria-valuenow', '40');
    expect(rpmBar).toHaveAttribute('aria-valuemax', '100');

    const tpmBar = screen.getByRole('progressbar', { name: 'Foreground TPM usage' });
    expect(tpmBar).toHaveAttribute('aria-valuenow', '12000');

    const rpdBar = screen.getByRole('progressbar', { name: 'Foreground RPD usage' });
    expect(rpdBar).toHaveAttribute('aria-valuenow', '300');
  });

  it('today-spend totals own bg.rpd (300) + the A6 cross-device sum (200) = 500', () => {
    renderPanel();
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(screen.getByTestId('genai-project-rpd')).toHaveTextContent('500 / 1000 requests');
  });

  it('renders ETA text reflecting the seeded fill', () => {
    renderPanel();
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    // fg.rpm 40/100 over a rolling minute → ~1.5 min to exhaust.
    expect(screen.getByText(/RPM exhausts:/)).toHaveTextContent('~2 min');
  });
});
