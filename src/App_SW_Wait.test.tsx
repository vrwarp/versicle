import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import App from './App';
import { Capacitor } from '@capacitor/core';
import { dbService } from './db/DBService';
import { audioPlayerService } from './lib/tts/AudioPlayerService';
import { useSyncStore } from './lib/sync/hooks/useSyncStore';
import { YjsObserverService } from './lib/crdt/YjsObserverService';
import { MigrationService } from './services/MigrationService';

// Mock MigrationService (Phase 2C)
vi.mock('./services/MigrationService', () => ({
  MigrationService: {
    hydrateIfNeeded: vi.fn(),
  },
}));

// Mock requestIdleCallback
global.requestIdleCallback = vi.fn((cb) => {
    return setTimeout(() => {
      cb({
        didTimeout: false,
        timeRemaining: () => 50,
      });
    }, 1) as unknown as number;
});
global.cancelIdleCallback = vi.fn((id) => clearTimeout(id));

// Mock SyncStore
vi.mock('./lib/sync/hooks/useSyncStore', () => ({
  useSyncStore: vi.fn(),
}));

// Mock Capacitor
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(),
  },
}));

// Mock DBService
vi.mock('./db/DBService', () => ({
  dbService: {
    getLibrary: vi.fn().mockResolvedValue([]),
    cleanup: vi.fn(),
  },
}));

// Mock db/db
vi.mock('./db/db', () => ({
  getDB: vi.fn().mockResolvedValue({}),
}));

// Mock AudioPlayerService
vi.mock('./lib/tts/AudioPlayerService', () => ({
  audioPlayerService: {
    initialize: vi.fn(),
  },
}));

// Mock useSyncOrchestrator
vi.mock('./lib/sync/hooks/useSyncOrchestrator', () => ({
  useSyncOrchestrator: vi.fn(),
}));

// Mock YjsObserverService
vi.mock('./lib/crdt/YjsObserverService', () => ({
  YjsObserverService: {
    getInstance: vi.fn().mockReturnValue({
      initialize: vi.fn(),
    }),
  },
}));

// Mock child components
vi.mock('./components/library/LibraryView', () => ({
  LibraryView: () => <div data-testid="library-view">Library View</div>,
}));
vi.mock('./components/reader/ReaderView', () => ({
  ReaderView: () => <div data-testid="reader-view">Reader View</div>,
}));
vi.mock('./components/reader/ReaderControlBar', () => ({
  ReaderControlBar: () => <div data-testid="reader-control-bar">Control Bar</div>,
}));
vi.mock('./components/ThemeSynchronizer', () => ({
  ThemeSynchronizer: () => null,
}));
vi.mock('./components/GlobalSettingsDialog', () => ({
  GlobalSettingsDialog: () => null,
}));
vi.mock('./components/ui/ToastContainer', () => ({
  ToastContainer: () => null,
}));
vi.mock('./components/SafeModeView', () => ({
  SafeModeView: () => <div>Safe Mode</div>,
}));

describe('App Service Worker Wait', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(global.navigator, 'serviceWorker', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  it('renders "Initializing..." when waiting for Service Worker', async () => {
     Object.defineProperty(global.navigator, 'serviceWorker', {
       value: {
         controller: null,
         ready: new Promise(() => {}), // Never ready
       },
       writable: true,
       configurable: true,
     });

     render(<App />);
     expect(screen.getByText('Initializing...')).toBeInTheDocument();
  });

  it('skips waiting if Service Worker is not supported', async () => {
     // Explicitly remove serviceWorker from navigator to simulate lack of support
     // @ts-expect-error - simulating browser environment
     delete global.navigator.serviceWorker;

     await act(async () => {
       render(<App />);
     });

     await waitFor(() => {
       expect(screen.getByTestId('library-view')).toBeInTheDocument();
     });
  });

  it('shows critical error if Service Worker controller is missing after polling', async () => {
    Object.defineProperty(global.navigator, 'serviceWorker', {
      value: {
        controller: null,
        ready: Promise.resolve(),
      },
      writable: true,
      configurable: true,
    });

    vi.useFakeTimers();

    render(<App />);

    // We need to advance enough time for all retries + some buffer.
    await act(async () => {
       await vi.advanceTimersByTimeAsync(2000);
    });

    vi.useRealTimers();

    // The component state should update to error.
    await waitFor(() => {
        expect(screen.getByText(/Service Worker failed to take control/)).toBeInTheDocument();
    });
  }, 10000);

  it('initializes successfully if controller appears during polling', async () => {
     const swMock = {
         controller: null,
         ready: Promise.resolve(),
     };
     Object.defineProperty(global.navigator, 'serviceWorker', {
         value: swMock,
         writable: true,
         configurable: true,
     });

     vi.useFakeTimers();
     render(<App />);

     expect(screen.getByText('Initializing...')).toBeInTheDocument();

     await act(async () => {
         await vi.advanceTimersByTimeAsync(20);
     });

     // @ts-expect-error - Mocking
     swMock.controller = {};

     await act(async () => {
         await vi.advanceTimersByTimeAsync(20);
     });

     vi.useRealTimers();

     await waitFor(() => {
         expect(screen.getByTestId('library-view')).toBeInTheDocument();
     });
  });
});
