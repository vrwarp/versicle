import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from './App';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';

// Mock DB
vi.mock('./db/db', () => ({
  getDB: vi.fn().mockResolvedValue({})
}));

// Mock DBService - Ensure it has getAllInventoryItems
vi.mock('./db/DBService', () => ({
  dbService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn(),
    getAllInventoryItems: vi.fn().mockResolvedValue([]),
    getDB: vi.fn().mockReturnValue({}),
  }
}));

// Mock migration to avoid DB calls
vi.mock('./lib/migration/YjsMigration', () => ({
  migrateToYjs: vi.fn().mockResolvedValue(undefined)
}));

// Mock useLibraryStore to avoid real store logic entirely
vi.mock('./store/useLibraryStore', () => ({
  useLibraryStore: (selector: any) => {
    // Return a mock state that includes hydrateStaticMetadata
    return selector({
      hydrateStaticMetadata: vi.fn().mockResolvedValue(undefined),
      books: {}
    });
  },
}));

// Mock all sub-components to focus on App logic
vi.mock('./components/library/LibraryView', () => ({ LibraryView: () => <div data-testid="library-view">Library View</div> }));
vi.mock('./components/reader/ReaderView', () => ({ ReaderView: () => <div data-testid="reader-view">Reader View</div> }));
vi.mock('./components/reader/ReaderControlBar', () => ({ ReaderControlBar: () => <div data-testid="reader-control-bar">Control Bar</div> }));
vi.mock('./components/ThemeSynchronizer', () => ({ ThemeSynchronizer: () => null }));
vi.mock('./components/GlobalSettingsDialog', () => ({ GlobalSettingsDialog: () => null }));
vi.mock('./components/ui/ToastContainer', () => ({ ToastContainer: () => null }));
vi.mock('./components/SafeModeView', () => ({ SafeModeView: () => <div>SafeMode</div> }));
vi.mock('./components/debug/YjsTest', () => ({ YjsTest: () => null }));

// Mock Router
vi.mock('react-router-dom', () => ({
  BrowserRouter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Routes: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Route: ({ element }: { element: React.ReactNode }) => <div>{element}</div>,
  useNavigate: vi.fn(),
}));

describe('App Service Worker Wait', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders "Initializing..." when waiting for Service Worker', async () => {
    // Mock navigator.serviceWorker
    const readyPromise = new Promise<void>((resolve) => {
      // Simulate delay
      setTimeout(() => resolve(), 100);
    });

    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: {
        ready: readyPromise,
        get controller() { return { postMessage: vi.fn() }; },
        register: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    render(<App />);

    // Should be initializing initially
    expect(screen.getByText('Connecting to database...')).toBeInTheDocument();

    // After ready resolves, it should render app (LibraryView)
    await waitFor(() => {
      expect(screen.queryByText('Connecting to database...')).not.toBeInTheDocument();
    });
  });

  it('skips waiting if Service Worker is not supported', async () => {
    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: undefined,
      configurable: true,
      writable: true
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

    render(<App />);

    // Should NOT be initializing (or very briefly)
    await waitFor(() => {
      expect(screen.queryByText('Connecting to database...')).not.toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it.skip('shows critical error if Service Worker controller is missing after polling', async () => {
    // Mock navigator.serviceWorker with ready but no controller
    const readyPromise = Promise.resolve();
    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: {
        ready: readyPromise,
        get controller() { return null; }, // Always null
        register: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    vi.useFakeTimers();
    render(<App />);

    // Initially initializing
    expect(screen.getByText('Connecting to database...')).toBeInTheDocument();

    // Fast-forward timers to exhaust retries
    let delay = 5;
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
      });
      delay *= 2;
    }
    // Advance a bit more to ensure rejection
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    vi.useRealTimers();

    // Then shows error
    await waitFor(() => {
      expect(screen.getByText('Critical Error')).toBeInTheDocument();
      expect(screen.getByText(/Service Worker failed to take control/)).toBeInTheDocument();
    });
  });

  it.skip('initializes successfully if controller appears during polling', async () => {
    const readyPromise = Promise.resolve();
    let controllerValue: unknown = null;

    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: {
        ready: readyPromise,
        get controller() { return controllerValue; },
        register: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    vi.useFakeTimers();
    render(<App />);

    // Initially no controller
    expect(screen.getByText('Connecting to database...')).toBeInTheDocument();

    // Make controller appear after some time
    setTimeout(() => {
      controllerValue = { postMessage: vi.fn() };
    }, 35);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });

    vi.useRealTimers();

    // Should NO LONGER show Initializing
    await waitFor(() => {
      expect(screen.queryByText('Connecting to database...')).not.toBeInTheDocument();
      expect(screen.queryByText('Critical Error')).not.toBeInTheDocument();
      expect(screen.getByText('Library View')).toBeInTheDocument();
    });
  });
});
