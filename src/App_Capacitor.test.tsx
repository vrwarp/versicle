/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render } from '@testing-library/react';
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

vi.mock('./store/useReaderStore', () => {
    return {
        useReaderStore: (selector: any) => selector({
            immersiveMode: false,
            currentBookId: null,
            currentSectionTitle: null,
        }),
    };
});

vi.mock('./store/useLibraryStore', () => ({
    useLibraryStore: (selector: any) => selector({ books: [] }),
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

  it('should not initialize anything specific when platform is web', async () => {
    (Capacitor.getPlatform as any).mockReturnValue('web');
    render(<App />);

    // Wait for effects
    await new Promise((resolve) => setTimeout(resolve, 0));
    // No assertions needed as we removed the foreground service calls
  });
});
