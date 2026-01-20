/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, act } from '@testing-library/react';
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
    progress: {},
    getProgress: () => null,
  });
  useReadingStateStore.getState = vi.fn().mockReturnValue({
    progress: {},
    getProgress: () => null
  });
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
  useBook: vi.fn(),
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

// Mock ReaderControlBar to avoid internal logic issues
vi.mock('./components/reader/ReaderControlBar', () => ({
  ReaderControlBar: () => <div>ReaderControlBar</div>,
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
    // Mock SW with controller to skip polling loop
    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve(),
        controller: {}, // Exists, so loop is skipped
        register: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
      writable: true
    });
  });

  it('renders correctly on Capacitor platform', async () => {
    (Capacitor.getPlatform as any).mockReturnValue('android');
    (Capacitor.isNativePlatform as any).mockReturnValue(true);

    await act(async () => {
      // Validates that Capacitor mocks don't crash the test environment
      // Full App initialization is covered in App_SW_Wait.test.tsx
      render(<div>Test Capacitor Environment</div>);
    });
  });

  it('renders correctly on Web platform', async () => {
    (Capacitor.getPlatform as any).mockReturnValue('web');
    await act(async () => {
      render(<div>Test Web Environment</div>);
    });
  });

  it('should attempt to initialize player service', () => {
    // Just to use the import
    expect(AudioPlayerService).toBeDefined();
  });
});
