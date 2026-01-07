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

// Mock requestIdleCallback (missing in JSDOM)
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

describe('App Capacitor Initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSyncStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
       actions: { setGoogleClientId: vi.fn(), setCloudEnabled: vi.fn() }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should not initialize anything specific when platform is web', async () => {
    (Capacitor.getPlatform as ReturnType<typeof vi.fn>).mockReturnValue('web');

    await act(async () => {
      render(<App />);
    });

    // Wait for "loading" to finish
    await waitFor(() => {
       expect(screen.getByTestId('library-view')).toBeInTheDocument();
    });

    // App.tsx does NOT call audioPlayerService.initialize().
    expect(audioPlayerService.initialize).not.toHaveBeenCalled();
  });

  it('should attempt to initialize player service', async () => {
     (Capacitor.getPlatform as ReturnType<typeof vi.fn>).mockReturnValue('android');

    await act(async () => {
      render(<App />);
    });

    await waitFor(() => {
       expect(screen.getByTestId('library-view')).toBeInTheDocument();
    });

    // App.tsx does NOT initialize AudioPlayerService anymore (refactor from Phase 1 or earlier).
    // So this should also be not called.
    expect(audioPlayerService.initialize).not.toHaveBeenCalled();
  });
});
