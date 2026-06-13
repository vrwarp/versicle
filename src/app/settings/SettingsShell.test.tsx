/**
 * Settings surface suite (Phase 8 §B): SettingsShell + registry + panels.
 *
 * Absorbs (test-absorption ledger, rule 8) the suites of the deleted
 * GlobalSettingsDialog god file:
 *  - GlobalSettingsDialog.predictability.test.tsx →
 *    describe('regression: settings panels are unmount-safe …')
 *  - GlobalSettingsDialog.test.tsx 'regression: wipe-all-data' →
 *    describe('regression: wipe-all-data …')
 *  - GlobalSettingsDialog.test.tsx Piper wiring → describe('TTSPanel …')
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { SettingsShell } from './SettingsShell';
import { SETTINGS_PANELS, resolveSettingsTab } from './registry';
import TTSPanel from './panels/TTSPanel';
import RecoveryPanel from './panels/RecoveryPanel';
import DataPanel from './panels/DataPanel';
import { ConfirmHost } from '@components/ui/ConfirmDialog';
import { useTTSSettingsStore } from '@store/useTTSSettingsStore';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { CheckpointService } from '@domains/sync/checkpoints/CheckpointService';
import { wipeAllData } from '@data/wipe';
import { renderWithStores, storeSeed, makeTTSVoice } from '@test/harness';

// The data wipe must only be reachable through wipeAllData (see the
// absorbed regression below) — never let the real wipe run in jsdom.
vi.mock('@data/wipe', () => ({
  wipeAllData: vi.fn().mockResolvedValue(undefined),
  registerWipeHook: vi.fn(),
}));

// Per the useAudioCommands contract, component tests mock the facade module.
const { audioCommands } = vi.hoisted(() => ({
  audioCommands: {
    downloadVoice: vi.fn(),
    deleteVoice: vi.fn().mockResolvedValue(undefined),
    checkVoiceDownloaded: vi.fn().mockResolvedValue(false),
    exportDiagnostics: vi.fn().mockResolvedValue({
      stats: { eventCount: 0, capacity: 2000, oldestWall: null },
      events: [],
    }),
    triggerDiagnosticsSnapshot: vi.fn().mockResolvedValue('snap-1'),
    listDiagnosticSnapshots: vi.fn().mockResolvedValue([]),
    deleteDiagnosticSnapshot: vi.fn().mockResolvedValue(undefined),
    clearDiagnosticSnapshots: vi.fn().mockResolvedValue(undefined),
    shareDiagnosticSnapshot: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@app/tts/useAudioCommands', () => ({
  useAudioCommands: () => audioCommands,
}));

function renderShellAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <div data-testid="home" /> },
      { path: '/settings/:tab?', element: <SettingsShell /> },
    ],
    { initialEntries: ['/', path], initialIndex: 1 },
  );
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(wipeAllData).mockClear();
});

describe('settings registry', () => {
  it('declares nine ordered panels with unique route ids', () => {
    expect(SETTINGS_PANELS).toHaveLength(9);
    const ids = SETTINGS_PANELS.map((p) => p.id);
    expect(new Set(ids).size).toBe(9);
    const orders = SETTINGS_PANELS.map((p) => p.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it('resolves route params (unknown → general)', () => {
    expect(resolveSettingsTab('diagnostics')).toBe('diagnostics');
    expect(resolveSettingsTab(undefined)).toBe('general');
    expect(resolveSettingsTab('bogus')).toBe('general');
  });
});

describe('SettingsShell', () => {
  it('deep link /settings/diagnostics opens the overlay on Diagnostics with real tablist semantics', async () => {
    renderShellAt('/settings/diagnostics');

    const tablist = await screen.findByRole('tablist', { name: 'Settings sections' });
    expect(tablist).toHaveAttribute('aria-orientation', 'vertical');

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(9);

    const diagTab = screen.getByRole('tab', { name: 'Diagnostics' });
    expect(diagTab).toHaveAttribute('aria-selected', 'true');

    // The lazy Diagnostics panel mounts (and ONLY the active tabpanel exists).
    await screen.findByText('Active Flight Buffer');
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });

  it('tab activation navigates to /settings/<id> as a replace (back still closes the overlay)', async () => {
    const { router } = renderShellAt('/settings/diagnostics');

    // Radix Tabs triggers activate on pointer-down (not click).
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Dictionary' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings/dictionary');
    });
    await screen.findByText('Pronunciation Lexicon');
    // replace-navigation: ONE back gesture leaves the whole overlay.
    expect(router.state.location.key).not.toBe('default');
    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
  });

  it('an unknown deep-link tab falls back to General', async () => {
    renderShellAt('/settings/not-a-tab');
    const generalTab = await screen.findByRole('tab', { name: 'General' });
    expect(generalTab).toHaveAttribute('aria-selected', 'true');
  });

  it('the close button navigates back to the underlying route', async () => {
    const { router } = renderShellAt('/settings');

    fireEvent.click(await screen.findByTestId('settings-close-button'));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    expect(screen.getByTestId('home')).toBeInTheDocument();
  });
});

describe('TTSPanel (absorbed: GlobalSettingsDialog Piper wiring)', () => {
  const piperSeeds = () => [
    storeSeed(useTTSSettingsStore, { providerId: 'piper' as const }),
    storeSeed(useTTSPlaybackStore, {
      voice: makeTTSVoice({ id: 'piper:v1', name: 'Piper Voice 1', provider: 'piper' }),
      voices: [makeTTSVoice({ id: 'piper:v1', name: 'Piper Voice 1', provider: 'piper' })],
    }),
  ];

  it('renders Piper voice-data UI from the stores (download offered when not ready)', async () => {
    renderWithStores(<TTSPanel />, { seeds: piperSeeds() });

    expect(screen.getByText('Voice Data')).toBeInTheDocument();
    await screen.findByText('Not Downloaded');
    expect(screen.getByText('Download Voice Data')).toBeInTheDocument();
  });

  it('shows download progress instead of the download button', async () => {
    renderWithStores(<TTSPanel />, {
      seeds: [
        storeSeed(useTTSSettingsStore, { providerId: 'piper' as const }),
        storeSeed(useTTSPlaybackStore, {
          voice: makeTTSVoice({ id: 'piper:v1', name: 'Piper Voice 1', provider: 'piper' }),
          voices: [makeTTSVoice({ id: 'piper:v1', name: 'Piper Voice 1', provider: 'piper' })],
          isDownloading: true,
          downloadProgress: 45,
          downloadStatus: 'Downloading models...',
        }),
      ],
    });

    expect(await screen.findByText('Downloading models...')).toBeInTheDocument();
    expect(screen.getByText('45%')).toBeInTheDocument();
    expect(screen.queryByText('Download Voice Data')).not.toBeInTheDocument();
  });

  it('triggers the facade download on button click', async () => {
    renderWithStores(<TTSPanel />, { seeds: piperSeeds() });

    fireEvent.click(await screen.findByText('Download Voice Data'));

    expect(audioCommands.downloadVoice).toHaveBeenCalledWith('piper:v1');
  });
});

describe('regression: settings panels are unmount-safe (absorbed: GlobalSettingsDialog predictability)', () => {
  // The dialog used to fire async work (piper voice-readiness probe,
  // checkpoint listing) whose resolution after unmount threw state updates
  // at dead components. The ignore-flag discipline moved into the panels.
  it('TTSPanel: checkVoiceDownloaded resolving after unmount does not throw', async () => {
    let voiceResolver: ((ready: boolean) => void) | undefined;
    audioCommands.checkVoiceDownloaded.mockImplementation(
      () => new Promise<boolean>((r) => { voiceResolver = r; }),
    );

    const { unmount } = renderWithStores(<TTSPanel />, {
      seeds: [
        storeSeed(useTTSSettingsStore, { providerId: 'piper' as const }),
        storeSeed(useTTSPlaybackStore, {
          voice: makeTTSVoice({ id: 'voice1', provider: 'piper' }),
        }),
      ],
    });
    expect(audioCommands.checkVoiceDownloaded).toHaveBeenCalled();

    unmount();

    let errorCaught = false;
    try {
      await act(async () => {
        voiceResolver?.(true);
      });
    } catch {
      errorCaught = true;
    }
    expect(errorCaught).toBe(false);
    audioCommands.checkVoiceDownloaded.mockResolvedValue(false);
  });

  it('RecoveryPanel: listCheckpoints resolving after unmount does not throw', async () => {
    type Checkpoints = Awaited<ReturnType<typeof CheckpointService.listCheckpoints>>;
    let checkpointsResolver: ((list: Checkpoints) => void) | undefined;
    const listSpy = vi
      .spyOn(CheckpointService, 'listCheckpoints')
      .mockImplementation(() => new Promise<Checkpoints>((r) => { checkpointsResolver = r; }));

    const { unmount } = renderWithStores(<RecoveryPanel />);
    expect(listSpy).toHaveBeenCalled();

    unmount();

    let errorCaught = false;
    try {
      await act(async () => {
        checkpointsResolver?.([]);
      });
    } catch {
      errorCaught = true;
    }
    expect(errorCaught).toBe(false);
  });
});

describe('regression: wipe-all-data — Clear All Data must route through wipeAllData (absorbed)', () => {
  // "Clear All Data" used to hand-enumerate IDB stores and call
  // localStorage.clear(), silently leaving the entire versicle-yjs database
  // (all user data) behind. The data panel must delegate to wipeAllData().
  // Phase 8 §D: confirmation flows through the accessible ConfirmDialog —
  // the ConfirmHost is rendered beside the panel exactly as App.tsx mounts
  // it above the router gate.
  const renderDataPanel = () =>
    renderWithStores(
      <MemoryRouter>
        <ConfirmHost />
        <DataPanel />
      </MemoryRouter>,
    );

  it('calls wipeAllData when the user confirms', async () => {
    renderDataPanel();

    fireEvent.click(screen.getByText('Clear All Data'));
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));

    await waitFor(() => {
      expect(wipeAllData).toHaveBeenCalledTimes(1);
    });
  });

  it('does not wipe when the confirmation is declined', async () => {
    renderDataPanel();

    fireEvent.click(screen.getByText('Clear All Data'));
    fireEvent.click(await screen.findByTestId('confirm-dialog-cancel'));

    await waitFor(() => {
      expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    });
    expect(wipeAllData).not.toHaveBeenCalled();
  });
});
