import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from './App';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';

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

// Mock migration
vi.mock('./lib/migration/YjsMigration', () => ({
  migrateToYjs: vi.fn().mockResolvedValue(undefined)
}));

// Mock Yjs Provider
vi.mock('./store/yjs-provider', () => ({
  waitForYjsSync: vi.fn().mockResolvedValue(undefined),
}));

// Mock SW Utils - The key fix
vi.mock('./lib/serviceWorkerUtils', () => ({
  waitForServiceWorkerController: vi.fn().mockResolvedValue(undefined),
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
      isLoading: false,
      error: null
    });
  };
  useLibraryStore.getState = () => ({
    hydrateStaticMetadata: hydrate,
    books: { 'b1': { id: 'b1' } },
    isHydrating: false,
    isLoading: false,
    error: null
  });
  return { useLibraryStore };
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
vi.mock('./components/SafeModeView', () => ({ SafeModeView: () => <div>SafeMode</div> }));

// Mock Yjs Sync
vi.mock('./lib/sync/hooks/useYjsSync', () => ({
  useYjsSync: vi.fn(),
}));

// Mock Router
vi.mock('react-router-dom', () => ({
  BrowserRouter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Routes: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Route: ({ element }: { element: React.ReactNode }) => <div>{element}</div>,
  useNavigate: vi.fn(),
}));

import { waitForServiceWorkerController } from './lib/serviceWorkerUtils';

describe('App Service Worker Wait (Refactored)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
