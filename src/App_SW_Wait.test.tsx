import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from './App';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConnection as getDB } from './data/connection';
import { wipeAllData } from './data/wipe';

// Mock the storage layer connection
vi.mock('./data/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data/connection')>()),
  getConnection: vi.fn().mockResolvedValue({}),
  closeConnection: vi.fn().mockResolvedValue(undefined),
}));



// Mock SW Utils - The key fix
vi.mock('./lib/serviceWorkerUtils', () => ({
  waitForServiceWorkerController: vi.fn().mockResolvedValue(undefined),
}));

// Mock Capacitor App
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
    removeAllListeners: vi.fn(),
    exitApp: vi.fn(),
  }
}));

// Phase 7: boot hydration goes through the library composition.
vi.mock('./app/library/createLibrary', () => ({
  getLibrary: () => ({
    service: {
      start: vi.fn(),
      hydrate: vi.fn().mockResolvedValue(undefined),
    },
    orchestrator: {},
    mutex: {},
  }),
}));

// Mock useLibraryStore
vi.mock('./store/useLibraryStore', () => {
  const hydrate = vi.fn().mockResolvedValue(undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const useLibraryStore = (selector: any) => {
    return selector({
      hydrateStaticMetadata: hydrate,
      books: {},
      isHydrating: false,
      hasHydrated: false,
      isLoading: false,
      error: null
    });
  };
  useLibraryStore.getState = () => ({
    hydrateStaticMetadata: hydrate,
    books: { 'b1': { id: 'b1' } },
    isHydrating: false,
    hasHydrated: false,
    isLoading: false,
    error: null
  });

  const useBookStore = {
    getState: vi.fn().mockReturnValue({
      books: { 'b1': { id: 'b1', title: 'Test Book' } }
    }),
    setState: vi.fn()
  };

  return { useLibraryStore, useBookStore };
});

vi.mock('zustand/react/shallow', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useShallow: (selector: any) => selector
}));

// Mock sub-components
vi.mock('./components/library/LibraryView', () => ({ LibraryView: () => <div data-testid="library-view">Library View</div> }));
vi.mock('./components/reader/ReaderView', () => ({ ReaderView: () => <div data-testid="reader-view">Reader View</div> }));
vi.mock('./components/reader/ReaderControlBar', () => ({ ReaderControlBar: () => <div data-testid="reader-control-bar">Control Bar</div> }));
vi.mock('./components/ThemeSynchronizer', () => ({ ThemeSynchronizer: () => null }));
vi.mock('./components/SafeModeView', () => ({
  SafeModeView: ({ onReset }: { onReset: () => void }) => (
    <div>
      SafeMode
      <button onClick={onReset}>Reset Database</button>
    </div>
  )
}));

// Mock the data wipe module (SafeMode reset must only route through it)
vi.mock('./data/wipe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data/wipe')>()),
  wipeAllData: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('./components/BackNavigationManager', () => ({ BackNavigationManager: () => null }));
vi.mock('./layouts/RootLayout', () => ({ RootLayout: () => <div data-testid="root-layout">RootLayout Mock</div> }));

// Mock Device Store to avoid Yjs middleware execution
vi.mock('./store/useDeviceStore', () => ({
  // The store registry aggregates each synced store's def at import time —
  // a wholesale module mock must keep exporting it.
  DEVICES_STORE_DEF: {
    name: 'devices',
    syncedKeys: ['devices'],
    hydration: 'replace',
    scopedDiff: false,
  },
  useDeviceStore: {
    getState: vi.fn().mockReturnValue({
      devices: {},
      renameDevice: vi.fn(),
      registerCurrentDevice: vi.fn(),
      deleteDevice: vi.fn(),
      touchDevice: vi.fn(),
    })
  }
}));

// Mock Router
vi.mock('react-router-dom', () => ({
  createBrowserRouter: vi.fn(),
  RouterProvider: () => <div>Library View</div>,
  Outlet: () => null,
  useNavigate: vi.fn(),
  useLocation: vi.fn().mockReturnValue({ pathname: '/' }),
}));

import { waitForServiceWorkerController } from './lib/serviceWorkerUtils';
import {
  notifyServiceWorkerDegradedOnce,
  resetServiceWorkerDegradedNoticeForTests,
} from './app/boot/useServiceWorkerGate';
import { useToastStore } from './store/useToastStore';

/**
 * Phase 8 §G — the HONEST soft gate. `waitForServiceWorkerController`
 * NEVER rejects (3 s ready-race + poll exhaustion both resolve), so the
 * legacy `swError` state and App's "Critical Error" screen were
 * unreachable dead code; both are deleted. The gate holds the boot screen
 * briefly and then proceeds regardless; degradation (no controller →
 * covers will not load) surfaces as a one-shot keyed toast in production
 * builds only.
 */
describe('App service-worker soft gate (Phase 8 §G)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('proceeds to the app once the SW wait settles', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (waitForServiceWorkerController as any).mockResolvedValue(undefined);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Library View')).toBeInTheDocument();
    });
  });

  it('regression: no hard SW boot block — the dead Critical Error screen stays deleted', async () => {
    // The wait resolving WITHOUT a controller (blocked SW, poll
    // exhaustion) must still boot the app — never an error screen.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (waitForServiceWorkerController as any).mockResolvedValue(undefined);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Library View')).toBeInTheDocument();
    });
    expect(screen.queryByText('Critical Error')).toBeNull();
  });
});

describe('regression: SW degraded-mode notice — one keyed toast, production lanes only', () => {
  const controlled = {
    serviceWorker: { controller: {} },
  } as unknown as Pick<Navigator, 'serviceWorker'>;
  const uncontrolled = {
    serviceWorker: { controller: null },
  } as unknown as Pick<Navigator, 'serviceWorker'>;
  const prodEnv = { dev: false, e2e: false };

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    resetServiceWorkerDegradedNoticeForTests();
    useToastStore.getState().hideToast();
  });

  afterEach(() => {
    resetServiceWorkerDegradedNoticeForTests();
    useToastStore.getState().hideToast();
    vi.restoreAllMocks();
  });

  it('fires app.swDegraded exactly ONCE when no controller took over (prod)', () => {
    notifyServiceWorkerDegradedOnce(uncontrolled, prodEnv);
    notifyServiceWorkerDegradedOnce(uncontrolled, prodEnv);

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].key).toBe('app.swDegraded');
  });

  it('stays silent when a controller is present', () => {
    notifyServiceWorkerDegradedOnce(controlled, prodEnv);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('stays silent in DEV/E2E lanes (Playwright blocks service workers by design)', () => {
    notifyServiceWorkerDegradedOnce(uncontrolled, { dev: true, e2e: false });
    resetServiceWorkerDegradedNoticeForTests();
    notifyServiceWorkerDegradedOnce(uncontrolled, { dev: false, e2e: true });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe('regression: wipe-all-data — SafeMode reset must route through wipeAllData', () => {
  // The SafeMode "Reset Database" used to delete only EpubLibraryDB, silently
  // leaving the versicle-yjs database (all user data) and Versicle
  // localStorage keys behind. It must delegate to wipeAllData().
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (waitForServiceWorkerController as any).mockResolvedValue(undefined);
    // Force the DB-init failure that puts the app into SafeMode.
    vi.mocked(getDB).mockRejectedValue(new Error('DB init failed'));
  });

  afterEach(() => {
    // Restore the suite-wide getDB behavior for other describes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getDB).mockReset().mockResolvedValue({} as any);
    vi.restoreAllMocks();
  });

  // Phase 8 §D: the native confirm() died — the reset flows through the
  // accessible ConfirmDialog (ConfirmHost mounts above the boot gate, so
  // even SafeMode gets it).
  it('calls wipeAllData when the user confirms the destructive reset', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('SafeMode')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Reset Database'));

    const confirmButton = await screen.findByTestId('confirm-dialog-confirm');
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(wipeAllData).toHaveBeenCalledTimes(1);
    });
  });

  it('does not wipe when the confirmation is declined', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('SafeMode')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Reset Database'));

    const cancelButton = await screen.findByTestId('confirm-dialog-cancel');
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    });
    expect(wipeAllData).not.toHaveBeenCalled();
  });
});
