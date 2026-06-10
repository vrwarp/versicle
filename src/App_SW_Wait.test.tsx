import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from './App';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { getDB } from './db/db';
import { wipeAllData } from './db/wipe';

// Mock DB
vi.mock('./db/db', () => ({
  getDB: vi.fn().mockResolvedValue({})
}));

// Mock DBService
vi.mock('./db/DBService', () => ({
  dbService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn(),
    getAllInventoryItems: vi.fn().mockResolvedValue([]),
    getDB: vi.fn().mockReturnValue({}),
  }
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
vi.mock('./components/GlobalSettingsDialog', () => ({ GlobalSettingsDialog: () => null }));
vi.mock('./components/ui/ToastContainer', () => ({ ToastContainer: () => null }));
vi.mock('./components/SafeModeView', () => ({
  SafeModeView: ({ onReset }: { onReset: () => void }) => (
    <div>
      SafeMode
      <button onClick={onReset}>Reset Database</button>
    </div>
  )
}));

// Mock the data wipe module (SafeMode reset must only route through it)
vi.mock('./db/wipe', () => ({
  wipeAllData: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('./components/BackNavigationManager', () => ({ BackNavigationManager: () => null }));
vi.mock('./layouts/RootLayout', () => ({ RootLayout: () => <div data-testid="root-layout">RootLayout Mock</div> }));

// Mock Device Store to avoid Yjs middleware execution
vi.mock('./store/useDeviceStore', () => ({
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

describe('App Service Worker Wait (Refactored)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('initializes successfully when SW controller is ready (mocked)', async () => {
    // Mock successful resolution
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (waitForServiceWorkerController as any).mockResolvedValue(undefined);

    render(<App />);

    // Initially waiting (React effect cycle)
    // Actually, if promise resolves immediately, we might see Library View immediately
    // or brief "Connecting..."

    await waitFor(() => {
      expect(screen.getByText('Library View')).toBeInTheDocument();
    });
  });

  it('shows critical error if SW controller wait fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Mock failure
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (waitForServiceWorkerController as any).mockRejectedValue(new Error('Controller missing'));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Critical Error')).toBeInTheDocument();
      expect(screen.getByText(/Service Worker failed to take control/)).toBeInTheDocument();
    });
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

  it('calls wipeAllData when the user confirms the destructive reset', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('SafeMode')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Reset Database'));

    await waitFor(() => {
      expect(wipeAllData).toHaveBeenCalledTimes(1);
    });
  });

  it('does not wipe when the confirmation is declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('SafeMode')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Reset Database'));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
    });
    expect(wipeAllData).not.toHaveBeenCalled();
  });
});
