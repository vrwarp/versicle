/**
 * Boot integration tests — the ENTRY GATE for the Phase 1b boot-sequencing
 * refactor (plan/overhaul/README.md §5 P1, contract-first.md C11).
 *
 * These pin the CURRENT observable boot behavior so the bootstrap.ts
 * extraction cannot silently change it:
 *
 *  1. Post-wipe first boot (empty library) reaches the library view, runs the
 *     one-time cover-blob repair, hydrates static metadata, registers the
 *     device, and initializes sync — without blocking on sync completion.
 *  2. The migration boot interceptor:
 *     - AWAITING_CONFIRMATION → sync is NOT initialized, zombie-checkpoint GC
 *       is skipped, and the confirmation modal renders once boot completes.
 *     - RESTORING_BACKUP → the backup checkpoint is restored and sync is NOT
 *       initialized.
 *     - standard boot → zombie pre-migration checkpoints older than 7 days
 *       are pruned, recent/manual checkpoints are left alone.
 *  3. Non-fatal boot steps (cover repair) failing must not prevent boot.
 *
 * The SW-wait gate behavior (success → library, failure → the dedicated
 * "Critical Error" screen, DB failure → SafeModeView + wipeAllData routing)
 * is pinned by App_SW_Wait.test.tsx and must stay green alongside this file.
 *
 * NOTE deliberately NOT pinned: render state during RESTORING_BACKUP (the
 * sequencer is allowed to halt rendering while the rollback reloads the
 * page), exact phase ordering of sync init relative to DB open, and the
 * device heartbeat start time — those are the C11 contract's to define.
 */
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from './App';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  return {
    books: {} as Record<string, { id: string }>,
    hydrateStaticMetadata: vi.fn(),
    registerCurrentDevice: vi.fn(),
    touchDevice: vi.fn(),
    syncInitialize: vi.fn(),
    restoreCheckpoint: vi.fn(),
    listCheckpoints: vi.fn(),
    deleteCheckpoint: vi.fn(),
    repairCoverBlobs: vi.fn(),
    shouldAutoSync: vi.fn(),
    scanAndIndex: vi.fn(),
    driveState: {
      linkedFolderId: null as string | null,
      lastScanTime: null as number | null,
    },
  };
});

// ── Boot collaborators (the storage layer, src/data — Phase 3) ──
vi.mock('./data/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data/connection')>()),
  getConnection: vi.fn().mockResolvedValue({}),
  closeConnection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./data/wipe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data/wipe')>()),
  wipeAllData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./lib/serviceWorkerUtils', () => ({
  waitForServiceWorkerController: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./lib/MaintenanceService', () => ({
  maintenanceService: {
    repairCorruptCoverBlobsOnce: h.repairCoverBlobs,
  },
}));

// The sync composition root (P4-3: the orchestrator replaced
// FirestoreSyncManager; boot drives it through these exports).
vi.mock('./app/sync/createSync', () => ({
  getSyncOrchestrator: vi.fn(() => ({ start: h.syncInitialize })),
  configureSyncBackendSelection: vi.fn(async () => undefined),
  stopSyncConnections: vi.fn(),
  stopSyncForWipe: vi.fn(),
}));

vi.mock('./domains/sync/checkpoints/CheckpointService', () => ({
  CheckpointService: {
    restoreCheckpoint: h.restoreCheckpoint,
    listCheckpoints: h.listCheckpoints,
    deleteCheckpoint: h.deleteCheckpoint,
  },
}));

vi.mock('./lib/drive/DriveScannerService', () => ({
  DriveScannerService: {
    shouldAutoSync: h.shouldAutoSync,
    scanAndIndex: h.scanAndIndex,
  },
}));

vi.mock('./store/useDriveStore', () => ({
  useDriveStore: {
    getState: vi.fn(() => h.driveState),
  },
}));

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
    getState: vi.fn(() => ({
      devices: {},
      registerCurrentDevice: h.registerCurrentDevice,
      touchDevice: h.touchDevice,
    })),
  },
}));

vi.mock('./store/useLibraryStore', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const useLibraryStore = (selector: any) =>
    selector({
      hydrateStaticMetadata: h.hydrateStaticMetadata,
      books: h.books,
      isHydrating: false,
      hasHydrated: false,
      isLoading: false,
      error: null,
    });
  useLibraryStore.getState = () => ({
    hydrateStaticMetadata: h.hydrateStaticMetadata,
    books: h.books,
    isHydrating: false,
    hasHydrated: false,
    isLoading: false,
    error: null,
  });

  const useBookStore = {
    getState: () => ({ books: h.books }),
    setState: vi.fn(),
  };

  return { useLibraryStore, useBookStore };
});

// ── UI surfaces ──
vi.mock('./components/library/LibraryView', () => ({
  LibraryView: () => <div data-testid="library-view">Library View</div>,
}));
vi.mock('./components/reader/ReaderView', () => ({
  ReaderView: () => <div data-testid="reader-view">Reader View</div>,
}));
vi.mock('./components/SafeModeView', () => ({
  SafeModeView: () => <div data-testid="safe-mode">SafeMode</div>,
}));
vi.mock('./components/sync/WorkspaceMigrationConfirmModal', () => ({
  WorkspaceMigrationConfirmModal: (props: { targetWorkspaceId: string; backupCheckpointId: number }) => (
    <div data-testid="migration-confirm-modal">
      migration:{props.targetWorkspaceId}:{props.backupCheckpointId}
    </div>
  ),
}));
vi.mock('./layouts/RootLayout', () => ({
  RootLayout: () => <div data-testid="root-layout">RootLayout Mock</div>,
}));

vi.mock('react-router-dom', () => ({
  createBrowserRouter: vi.fn(),
  RouterProvider: () => <div data-testid="library-route">Library View</div>,
  Outlet: () => null,
  useNavigate: vi.fn(),
  useLocation: vi.fn().mockReturnValue({ pathname: '/' }),
}));

const MIGRATION_STATE_KEY = '__VERSICLE_MIGRATION_STATE__';

/** Default happy-path mock behavior; individual tests override. */
function resetBootMocks() {
  vi.clearAllMocks();
  h.books = {};
  h.driveState = { linkedFolderId: null, lastScanTime: null };
  h.hydrateStaticMetadata.mockResolvedValue(undefined);
  h.repairCoverBlobs.mockResolvedValue(undefined);
  h.syncInitialize.mockReturnValue(new Promise(() => {})); // never resolves — boot must not block on sync
  h.restoreCheckpoint.mockReturnValue(new Promise(() => {})); // restore reloads the page; never resolves in tests
  h.listCheckpoints.mockResolvedValue([]);
  h.deleteCheckpoint.mockResolvedValue(undefined);
  h.shouldAutoSync.mockResolvedValue(false);
  h.scanAndIndex.mockResolvedValue(undefined);
}

beforeEach(() => {
  resetBootMocks();
  window.localStorage.removeItem(MIGRATION_STATE_KEY);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  window.localStorage.removeItem(MIGRATION_STATE_KEY);
  vi.restoreAllMocks();
});

describe('boot: post-wipe first boot', () => {
  it('reaches the library with an empty library, after repair + hydrate + device registration + sync init', async () => {
    h.books = {}; // post-wipe: nothing for the Yjs middleware to deliver

    render(<App />);

    // The empty-library book poll waits ~10×100ms before proceeding.
    await waitFor(
      () => {
        expect(screen.getByText('Library View')).toBeInTheDocument();
      },
      { timeout: 8000 },
    );

    expect(h.repairCoverBlobs).toHaveBeenCalledTimes(1);
    expect(h.hydrateStaticMetadata).toHaveBeenCalledTimes(1);
    expect(h.registerCurrentDevice).toHaveBeenCalledTimes(1);
    expect(h.registerCurrentDevice).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ theme: expect.any(String) }),
    );
    // Standard boot initializes sync, but the boot path must NOT await its
    // completion (the mock promise never resolves).
    expect(h.syncInitialize).toHaveBeenCalledTimes(1);
    // No migration in flight → no confirmation modal.
    expect(screen.queryByTestId('migration-confirm-modal')).not.toBeInTheDocument();
  }, 20000);

  it('boots to the library even when the one-time cover repair fails', async () => {
    h.books = { b1: { id: 'b1' } };
    h.repairCoverBlobs.mockRejectedValue(new Error('repair exploded'));

    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByText('Library View')).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    expect(screen.queryByTestId('safe-mode')).not.toBeInTheDocument();
  });
});

describe('boot: zombie checkpoint GC (standard boot only)', () => {
  it('prunes pre-migration checkpoints older than 7 days, keeps recent and manual ones', async () => {
    h.books = { b1: { id: 'b1' } };
    const now = Date.now();
    const EIGHT_DAYS = 8 * 24 * 60 * 60 * 1000;
    h.listCheckpoints.mockResolvedValue([
      { id: 7, trigger: 'pre-migration', timestamp: now - EIGHT_DAYS },
      { id: 8, trigger: 'pre-migration', timestamp: now - 1000 },
      { id: 9, trigger: 'manual', timestamp: now - EIGHT_DAYS },
    ]);

    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByText('Library View')).toBeInTheDocument();
      },
      { timeout: 8000 },
    );

    await waitFor(() => {
      expect(h.deleteCheckpoint).toHaveBeenCalledWith(7);
    });
    expect(h.deleteCheckpoint).toHaveBeenCalledTimes(1);
  });
});

describe('boot: migration interceptor — AWAITING_CONFIRMATION', () => {
  beforeEach(() => {
    window.localStorage.setItem(
      MIGRATION_STATE_KEY,
      JSON.stringify({
        status: 'AWAITING_CONFIRMATION',
        targetWorkspaceId: 'ws-target',
        backupCheckpointId: 42,
      }),
    );
  });

  it('halts sync init, skips checkpoint GC, and shows the confirmation modal after boot', async () => {
    h.books = { b1: { id: 'b1' } };

    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByTestId('migration-confirm-modal')).toBeInTheDocument();
      },
      { timeout: 8000 },
    );

    // The modal must carry the persisted migration parameters.
    expect(screen.getByTestId('migration-confirm-modal')).toHaveTextContent('migration:ws-target:42');
    // The app shell still renders behind the modal.
    expect(screen.getByText('Library View')).toBeInTheDocument();

    // "Do NOT initialize sync" is the entire point of this state.
    expect(h.syncInitialize).not.toHaveBeenCalled();
    // Zombie GC belongs to the standard boot path only.
    expect(h.listCheckpoints).not.toHaveBeenCalled();
    expect(h.restoreCheckpoint).not.toHaveBeenCalled();
  });
});

describe('boot: migration interceptor — RESTORING_BACKUP', () => {
  it('restores the backup checkpoint and never initializes sync', async () => {
    window.localStorage.setItem(
      MIGRATION_STATE_KEY,
      JSON.stringify({
        status: 'RESTORING_BACKUP',
        targetWorkspaceId: 'ws-target',
        backupCheckpointId: 42,
      }),
    );
    h.books = { b1: { id: 'b1' } };

    render(<App />);

    await waitFor(() => {
      // The second arg is the §D7 pauseSync shutdown handle.
      expect(h.restoreCheckpoint).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ pauseSync: expect.any(Function) }),
      );
    });

    expect(h.syncInitialize).not.toHaveBeenCalled();
    expect(h.listCheckpoints).not.toHaveBeenCalled();
    // The rollback path never raises the confirmation modal.
    expect(screen.queryByTestId('migration-confirm-modal')).not.toBeInTheDocument();
  });
});

describe('boot: background Drive scan policy', () => {
  it('does not consult the scanner when no Drive folder is linked', async () => {
    h.books = { b1: { id: 'b1' } };
    h.driveState = { linkedFolderId: null, lastScanTime: null };

    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByText('Library View')).toBeInTheDocument();
      },
      { timeout: 8000 },
    );

    expect(h.shouldAutoSync).not.toHaveBeenCalled();
    expect(h.scanAndIndex).not.toHaveBeenCalled();
  });

  it('scans when a linked folder is stale and the heuristic approves', async () => {
    h.books = { b1: { id: 'b1' } };
    const EIGHT_DAYS = 8 * 24 * 60 * 60 * 1000;
    h.driveState = { linkedFolderId: 'folder-1', lastScanTime: Date.now() - EIGHT_DAYS };
    h.shouldAutoSync.mockResolvedValue(true);

    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByText('Library View')).toBeInTheDocument();
      },
      { timeout: 8000 },
    );

    await waitFor(() => {
      expect(h.scanAndIndex).toHaveBeenCalledTimes(1);
    });
    expect(h.shouldAutoSync).toHaveBeenCalledTimes(1);
  });

  it('skips the scan when the heuristic declines', async () => {
    h.books = { b1: { id: 'b1' } };
    const EIGHT_DAYS = 8 * 24 * 60 * 60 * 1000;
    h.driveState = { linkedFolderId: 'folder-1', lastScanTime: Date.now() - EIGHT_DAYS };
    h.shouldAutoSync.mockResolvedValue(false);

    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByText('Library View')).toBeInTheDocument();
      },
      { timeout: 8000 },
    );

    expect(h.shouldAutoSync).toHaveBeenCalledTimes(1);
    expect(h.scanAndIndex).not.toHaveBeenCalled();
  });
});
