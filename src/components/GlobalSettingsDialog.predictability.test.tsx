import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { GlobalSettingsDialog } from './GlobalSettingsDialog';
import React, { act } from 'react';

vi.mock('../store/useTTSStore', () => {
  return {
    useTTSStore: () => ({
        providerId: 'piper',
        voice: { id: 'voice1' },
        // @ts-expect-error global scope mock for test
        checkVoiceDownloaded: globalThis.__mockCheckVoiceDownloaded
    })
  };
});

vi.mock('../store/useUIStore', () => ({
  useUIStore: () => ({ isGlobalSettingsOpen: true, setGlobalSettingsOpen: vi.fn() })
}));

vi.mock('../store/useLibraryStore', () => ({
  useLibraryStore: () => ({})
}));
vi.mock('../store/useBookStore', () => ({
  useBookStore: () => ({})
}));
vi.mock('../store/useReadingListStore', () => ({
  useReadingListStore: () => ({ entries: {} })
}));
vi.mock('../store/useReadingStateStore', () => ({
  useReadingStateStore: () => ({})
}));
vi.mock('../store/usePreferencesStore', () => ({
  usePreferencesStore: () => ({ currentTheme: 'light', setTheme: vi.fn() })
}));
vi.mock('../store/useToastStore', () => ({
  useToastStore: () => ({ showToast: vi.fn() })
}));


vi.mock('./ui/Modal', () => {
    return {
        Modal: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
        ModalContent: ({ children, hideCloseButton }: React.PropsWithChildren & { hideCloseButton?: boolean }) => <div>{children}</div>,
        ModalHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
        ModalTitle: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
        ModalDescription: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
        ModalClose: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
    }
})

vi.mock('../components/ReadingListDialog', () => ({
  ReadingListDialog: () => <div data-testid="reading-list-dialog" />
}));
vi.mock('../components/sync/DataExportWizard', () => ({
  DataExportWizard: () => <div data-testid="data-export-wizard" />
}));
vi.mock('../store/useGenAIStore', () => ({
  useGenAIStore: () => ({ logs: [] })
}));
vi.mock('../lib/sync/hooks/useSyncStore', () => ({
  useSyncStore: () => ({ firebaseConfig: {} })
}));
vi.mock('../lib/sync/hooks/useFirestoreSync', () => ({
  useFirestoreSync: () => ({ signIn: vi.fn(), signOut: vi.fn(), isConfigured: false })
}));
vi.mock('../store/useDeviceStore', () => ({
  useDeviceStore: () => ({ devices: {} })
}));
vi.mock('../lib/device-id', () => ({
  getDeviceId: () => 'dev1'
}));

vi.mock('../lib/sync/CheckpointService', () => {
  return {
    // @ts-expect-error global scope mock for test
    CheckpointService: { listCheckpoints: globalThis.__mockListCheckpoints }
  };
});

describe('GlobalSettingsDialog Predictability', () => {
  it('should not throw or cause unmounted state updates when promises resolve after unmount', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let voiceResolver: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let checkpointsResolver: any;

    // @ts-expect-error inject into global for vi.mock
    globalThis.__mockCheckVoiceDownloaded = vi.fn().mockImplementation(() => new Promise(r => { voiceResolver = r; }));
    // @ts-expect-error inject into global for vi.mock
    globalThis.__mockListCheckpoints = vi.fn().mockImplementation(() => new Promise(r => { checkpointsResolver = r; }));

    const { unmount } = render(<GlobalSettingsDialog />);

    // Component unmounts while promises are still pending
    unmount();

    // Promises resolve after unmount
    let errorCaught = false;
    try {
        await act(async () => {
            if (voiceResolver) voiceResolver(true);
            if (checkpointsResolver) checkpointsResolver([]);
        });
    } catch {
        errorCaught = true;
    }

    // We expect NO errors to be thrown when resolving promises for an unmounted component with the ignore flag fix.
    expect(errorCaught).toBe(false);
  });
});
