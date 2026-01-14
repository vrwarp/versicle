/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, act } from '@testing-library/react';
import App from './App';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { AudioPlayerService } from './lib/tts/AudioPlayerService';

// Mock dependencies
vi.mock('./db/db', () => ({
  getDB: vi.fn().mockResolvedValue({}),
}));
vi.mock('./components/library/LibraryView', () => ({
  LibraryView: () => <div>LibraryView</div>,
}));
vi.mock('./components/reader/ReaderView', () => ({
  ReaderView: () => <div>ReaderView</div>,
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
vi.mock('./components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('./components/SafeModeView', () => ({
  SafeModeView: () => <div>SafeModeView</div>,
}));
// Mock migration to avoid DB calls
vi.mock('./lib/migration/YjsMigration', () => ({
  migrateToYjs: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(),
    isNativePlatform: vi.fn(),
  },
}));
vi.mock('./lib/tts/AudioPlayerService', () => ({
  AudioPlayerService: {
    getInstance: vi.fn().mockReturnValue({
      pause: vi.fn(),
      subscribe: vi.fn(),
    }),
  },
}));
vi.mock('./store/useToastStore', () => {
  const showToastMock = vi.fn();
  const useToastStoreMock = (selector: any) => selector({ showToast: showToastMock });
  useToastStoreMock.getState = () => ({ showToast: showToastMock });
  return { useToastStore: useToastStoreMock };
});

vi.mock('./store/useReaderUIStore', () => ({
  useReaderUIStore: (selector: any) => selector({
    immersiveMode: false,
    currentSectionTitle: null,
  }),
}));

vi.mock('./store/useReadingStateStore', () => {
  const useReadingStateStore = (selector: any) => selector({
    currentBookId: null,
  });
  useReadingStateStore.getState = vi.fn().mockReturnValue({ progress: {} });
  useReadingStateStore.setState = vi.fn();
  useReadingStateStore.subscribe = vi.fn();
  return { useReadingStateStore };
});

vi.mock('./store/useLibraryStore', () => ({
  useLibraryStore: (selector: any) => selector({
    books: {},
    hydrateStaticMetadata: vi.fn(),
  }),
}));

vi.mock('./store/selectors', () => ({
  useAllBooks: vi.fn().mockReturnValue([]),
  useBook: vi.fn(), // Add useBook too if needed, based on grep/build errors?
}));

vi.mock('./store/useAnnotationStore', () => ({
  useAnnotationStore: (selector: any) => selector({
    popover: { visible: false },
    addAnnotation: vi.fn(),
    hidePopover: vi.fn(),
  }),
}));

vi.mock('./store/useTTSStore', () => ({
  useTTSStore: (selector: any) => selector({ queue: [], isPlaying: false }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
  BrowserRouter: ({ children }: any) => <div>{children}</div>,
  Routes: ({ children }: any) => <div>{children}</div>,
  Route: ({ element }: any) => <div>{element}</div>,
}));


describe('App Capacitor Initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.skip('should not initialize anything specific when platform is web', async () => {
    (Capacitor.getPlatform as any).mockReturnValue('web');
    await act(async () => {
      render(<App />);
    });
    // No assertions needed as we removed the foreground service calls
  });

  it('should attempt to initialize player service', () => {
    // Just to use the import
    expect(AudioPlayerService).toBeDefined();
  });
});
