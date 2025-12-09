/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render } from '@testing-library/react';
import App from './App';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { ForegroundService, Importance } from '@capawesome-team/capacitor-android-foreground-service';
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
vi.mock('@capawesome-team/capacitor-android-foreground-service', () => ({
  ForegroundService: {
    createNotificationChannel: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  },
  Importance: { Default: 3 }
}));
vi.mock('./lib/tts/AudioPlayerService', () => ({
  AudioPlayerService: {
    getInstance: vi.fn().mockReturnValue({
      pause: vi.fn(),
    }),
  },
}));
vi.mock('./store/useToastStore', () => ({
    useToastStore: {
        getState: () => ({
            showToast: vi.fn()
        })
    }
}));


describe('App Capacitor Initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize Android ForegroundService when platform is android', async () => {
    (Capacitor.getPlatform as any).mockReturnValue('android');
    render(<App />);

    // Wait for effects
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ForegroundService.createNotificationChannel).toHaveBeenCalledWith({
      id: 'versicle_tts_channel',
      name: 'Versicle Playback',
      description: 'Controls for background reading',
      importance: 3
    });

    expect(ForegroundService.addListener).toHaveBeenCalledWith('buttonClicked', expect.any(Function));
  });

  it('should not initialize Android ForegroundService when platform is web', async () => {
    (Capacitor.getPlatform as any).mockReturnValue('web');
    render(<App />);

    // Wait for effects
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ForegroundService.createNotificationChannel).not.toHaveBeenCalled();
    expect(ForegroundService.addListener).not.toHaveBeenCalled();
  });

  it('should call AudioPlayerService.pause when notification button is clicked', async () => {
    (Capacitor.getPlatform as any).mockReturnValue('android');
    const pauseMock = vi.fn();
    (AudioPlayerService.getInstance as any).mockReturnValue({ pause: pauseMock });

    let listenerCallback: any;
    (ForegroundService.addListener as any).mockImplementation((event: string, callback: any) => {
        listenerCallback = callback;
        return Promise.resolve({ remove: vi.fn() });
    });

    render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (listenerCallback) {
        await listenerCallback({ buttonId: 101 });
    }

    expect(pauseMock).toHaveBeenCalled();
  });
});
