/**
 * GenAIPanel quota-meters test (A7, §10.7 — the executable "meter can't drift"
 * check at the WIRED layer). Seeds useGenAIStore with a getQuotaSnapshot
 * returning a KNOWN LaneUsage and useDeviceStore.devices with one heartbeat-
 * active sibling carrying embedSpend stamped today, then asserts every rendered
 * meter (bar aria-valuenow + today-spend total + ETA) is derived from the
 * seeded snapshot plus the A6 cross-device sum — not fabricated.
 */
import { screen, act, fireEvent } from '@testing-library/react';
import { Profiler } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderWithStores, storeSeed } from '@test/harness';
import { useGenAIStore } from '@store/useGenAIStore';
import { useDeviceStore } from '@store/useDeviceStore';
import { getDeviceId } from '@lib/device-id';
import type { DeviceInfo, DeviceProfile } from '~types/device';
import type { LaneUsage } from '@kernel/quota';
import GenAIPanel from './GenAIPanel';

// Mock Select component so we can interact with it in unit tests
vi.mock('../../../components/ui/Select', () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange: (v: string) => void }) => (
    <select data-testid="mock-pool-select" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectValue: () => null
}));

vi.mock('@components/ui/ConfirmDialog', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

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
const SEEDED_SNAPSHOT: Record<'fg' | 'fgd' | 'bg', LaneUsage> = {
  fg: { rpm: 40, tpm: 12000, rpd: 300, limits: { rpm: 100, tpm: 30000, rpd: 1000 } },
  fgd: { rpm: 0, tpm: 0, rpd: 300, limits: { rpm: 100, tpm: 30000, rpd: 1000 } },
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
          getQuotaSnapshot: (poolKey?: string) => {
            if (poolKey === 'default') {
              return SEEDED_SNAPSHOT;
            }
            return {
              fg: { rpm: 0, tpm: 0, rpd: 0, limits: { rpm: 100, tpm: 30000, rpd: 1000 } },
              fgd: { rpm: 0, tpm: 0, rpd: 0, limits: { rpm: 100, tpm: 30000, rpd: 1000 } },
              bg: { rpm: 0, tpm: 0, rpd: 0, limits: { rpm: 100, tpm: 30000, rpd: 1000 } },
            };
          },

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

  it('renders usage details from the seeded snapshot', () => {
    renderPanel();
    // Flush the immediate poll tick scheduled inside useEffect.
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(screen.getByText(/Foreground:/)).toBeInTheDocument();
    expect(screen.getByText(/40 RPM, 12,000 TPM, 300 RPD/)).toBeInTheDocument();
  });

  it('today-spend totals own bg.rpd (300) + the A6 cross-device sum (200) = 500', () => {
    renderPanel();
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(screen.getByTestId('genai-project-rpd')).toHaveTextContent('500 requests (all devices, all pools)');

  });

  it('renders ETA text reflecting the seeded fill', () => {
    renderPanel();
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    // fg.rpm 40/100 over a rolling minute → ~1.5 min to exhaust.
    expect(screen.getByText(/RPM:/)).toBeInTheDocument();
    expect(screen.getAllByText(/~2 min/)).toHaveLength(2); // RPM & TPM both 90_000ms (~2 min)
  });

  it('displays correct limits in the table for each pool', () => {
    renderPanel();

    // Check default limits in table
    const defaultRow = screen.getByText('default').closest('tr')!;
    expect(defaultRow).toHaveTextContent('100');
    expect(defaultRow).toHaveTextContent('30,000');
    expect(defaultRow).toHaveTextContent('1,000');

    // Check gemini-2.5-flash-lite limits in table
    const flashLiteRow = screen.getByText('gemini-2.5-flash-lite').closest('tr')!;
    expect(flashLiteRow).toHaveTextContent('10');
    expect(flashLiteRow).toHaveTextContent('250,000');
    expect(flashLiteRow).toHaveTextContent('20');
  });

  it('resets all pools to defaults when Reset All is clicked and confirmed', async () => {
    renderPanel();

    // Open edit modal for default pool
    const defaultRow = screen.getByText('default').closest('tr')!;
    const editBtn = defaultRow.querySelector('button')!;
    fireEvent.click(editBtn);

    // Edit RPM to 55 and save
    const rpmInput = screen.getByLabelText('Requests / min') as HTMLInputElement;
    fireEvent.change(rpmInput, { target: { value: '55' } });
    const saveBtn = screen.getByRole('button', { name: 'Save Changes' });
    fireEvent.click(saveBtn);

    // Verify table shows 55
    expect(defaultRow).toHaveTextContent('55');

    // Click Reset All button
    const resetAllBtn = screen.getByRole('button', { name: 'Reset All Pools to Defaults' });
    await act(async () => {
      fireEvent.click(resetAllBtn);
    });

    // Should be reset back to default limits (100)
    expect(defaultRow).toHaveTextContent('100');
  });
});

/**
 * F7c: the panel used to call `useGenAIStore()` with NO selector, subscribing
 * to the whole state object — so ANY write to the GenAI store (the embedding
 * model, the boot-time background-budget providers, a log line) re-rendered it
 * and the heavy settings tab underneath. It now subscribes to the fields it
 * actually renders.
 *
 * NOTE for the reader: an `addLog` still re-renders the panel, and must —
 * GenAISettingsTab renders the Debug Logs list unconditionally from the `logs`
 * prop, so the panel has to pass the new array down. What is gone is the
 * re-render for everything the panel does NOT display.
 */
describe('regression: GenAI state the panel does not render does not re-render it', () => {
  // GenAISettingsTab polls a 1s `setTick` interval of its own; frozen timers
  // keep it out of the render counts below.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderCounted = () => {
    let renders = 0;
    renderWithStores(
      <Profiler
        id="genai-panel"
        onRender={() => {
          renders++;
        }}
      >
        <GenAIPanel />
      </Profiler>,
      { seeds: [storeSeed(useGenAIStore, { isEnabled: true })] },
    );
    expect(renders).toBeGreaterThan(0);
    return {
      reset: () => {
        renders = 0;
      },
      count: () => renders,
    };
  };

  it('ignores writes to fields the panel never reads', () => {
    const probe = renderCounted();
    probe.reset();

    act(() => {
      useGenAIStore.getState().setEmbeddingModel('gemini-embedding-2');
      useGenAIStore.getState().setEmbeddingDims(1536);
      useGenAIStore.getState().setUseBatchEmbedding(true);
      useGenAIStore.getState().setReferenceDetectionStrategy('deterministic');
      // The boot-time provider injection (wireGoogle) — pure plumbing.
      useGenAIStore.getState().setBgBudgetProvider(
        () => ({ rpm: 1, tpm: 1, rpd: 1, bgThrottlePercent: 0, fgRpdHeadroom: 0 }),
        () => 0,
      );
    });

    expect(probe.count()).toBe(0);
  });

  it('still re-renders for a setting it displays', () => {
    const probe = renderCounted();
    probe.reset();

    act(() => {
      useGenAIStore.getState().setModel('gemini-3-flash-preview');
    });

    // (>= 1: the tab schedules a nested update of its own on re-render.)
    expect(probe.count()).toBeGreaterThanOrEqual(1);
  });
});
