import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GlobalSettingsDialog } from './GlobalSettingsDialog';
import { useTTSStore } from '../store/useTTSStore';

// Mock Radix UI Modal to avoid title warnings
vi.mock('./ui/Modal', () => {
    return {
        Modal: ({ open, children }: { open: boolean, children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null,
        ModalContent: ({ children, 'aria-describedby': ariaDescribedBy }: { children: React.ReactNode, className?: string, 'aria-describedby'?: string }) => (
            <div>
                {/* Ensure accessibility elements are present in tests */}
                <h1>Global Settings</h1>
                <p id={ariaDescribedBy || "dialog-desc"}>Global application settings including appearance, TTS configuration, and data management.</p>
                {children}
            </div>
        ),
        ModalHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
        ModalTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    };
});

// Mock useUIStore
vi.mock('../store/useUIStore', () => ({
    useUIStore: () => ({
        isGlobalSettingsOpen: true,
        setGlobalSettingsOpen: vi.fn(),
    })
}));

// Mock useGenAIStore
vi.mock('../store/useGenAIStore', () => ({
    useGenAIStore: () => ({
        apiKey: '',
        setApiKey: vi.fn(),
        model: '',
        setModel: vi.fn(),
        isEnabled: false,
        setEnabled: vi.fn(),
    })
}));

// Mock useTTSStore
const mockSetVoice = vi.fn();
const mockDownloadVoice = vi.fn();
const mockCheckVoiceDownloaded = vi.fn().mockResolvedValue(false);
const mockSetProviderId = vi.fn();

vi.mock('../store/usePreferencesStore', () => ({
    usePreferencesStore: vi.fn(() => ({
        currentTheme: 'light',
        setTheme: vi.fn(),
        fontFamily: 'serif',
        lineHeight: 1.5,
        fontSize: 100,
        shouldForceFont: false
    }))
}));

vi.mock('../store/useLibraryStore', () => ({
    useLibraryStore: vi.fn(() => ({
        addBooks: vi.fn(),
        fetchBooks: vi.fn(),
        isImporting: false,
        importProgress: 0,
        importStatus: '',
        uploadProgress: 0,
        uploadStatus: ''
    }))
}));

vi.mock('../db/DBService', () => ({
    dbService: {
        getReadingList: vi.fn().mockResolvedValue([]),
        getReadingHistory: vi.fn().mockResolvedValue([]),
        importReadingList: vi.fn(),
        clearContentAnalysis: vi.fn(),
        cleanup: vi.fn()
    }
}));

vi.mock('../lib/sync/hooks/useSyncStore', () => ({
    useSyncStore: () => ({
        googleClientId: '',
        googleApiKey: '',
        setGoogleCredentials: vi.fn(),
        isSyncEnabled: false,
        setSyncEnabled: vi.fn()
    })
}));

vi.mock('../lib/sync/CheckpointService', () => ({
    CheckpointService: {
        listCheckpoints: vi.fn().mockResolvedValue([]),
        restoreCheckpoint: vi.fn()
    }
}));

vi.mock('../store/useReadingListStore', () => ({
    useReadingListStore: Object.assign(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (selector: any) => selector ? selector({ entries: {} }) : { entries: {} },
        {
            getState: () => ({
                entries: {},
                upsertEntry: vi.fn()
            })
        }
    )
}));

vi.mock('../store/useReadingStateStore', () => ({
    useReadingStateStore: Object.assign(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (selector: any) => selector ? selector({ progress: {} }) : { progress: {} },
        {
            getState: () => ({
                progress: {},
                updateLocation: vi.fn()
            })
        }
    )
}));

vi.mock('../store/useToastStore', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useToastStore: (selector: any) => selector ? selector({ showToast: vi.fn() }) : { showToast: vi.fn() }
}));

vi.mock('../store/useTTSStore', () => ({
    useTTSStore: vi.fn()
}));

describe('GlobalSettingsDialog - Piper TTS', () => {
    const defaultStore = {
        providerId: 'local',
        setProviderId: mockSetProviderId,
        apiKeys: {},
        setApiKey: vi.fn(),
        backgroundAudioMode: 'silence',
        setBackgroundAudioMode: vi.fn(),
        whiteNoiseVolume: 0.1,
        setWhiteNoiseVolume: vi.fn(),
        voice: null,
        voices: [],
        setVoice: mockSetVoice,
        downloadVoice: mockDownloadVoice,
        downloadProgress: 0,
        downloadStatus: null,
        isDownloading: false,
        checkVoiceDownloaded: mockCheckVoiceDownloaded,
        lastError: null
    };

    it('renders Piper settings when provider is Piper', () => {
        // @ts-expect-error Mock implementation
        useTTSStore.mockReturnValue({
            ...defaultStore,
            providerId: 'piper',
            voices: [{ id: 'piper:v1', name: 'Piper Voice 1' }],
            voice: { id: 'piper:v1', name: 'Piper Voice 1' }
        });

        render(<GlobalSettingsDialog />);

        // Switch to TTS tab
        fireEvent.click(screen.getByText('TTS Engine'));

        // Check if Piper-specific UI is present
        expect(screen.getByText('Select Voice')).toBeInTheDocument();
        expect(screen.getByText('Piper Voice 1')).toBeInTheDocument();
        expect(screen.getByText('Voice Data')).toBeInTheDocument();
        expect(screen.getByText('Not Downloaded')).toBeInTheDocument();
        expect(screen.getByText('Download Voice Data')).toBeInTheDocument();
    });

    it('shows download progress', () => {
        // @ts-expect-error Mock implementation
        useTTSStore.mockReturnValue({
            ...defaultStore,
            providerId: 'piper',
            voices: [{ id: 'piper:v1', name: 'Piper Voice 1' }],
            voice: { id: 'piper:v1', name: 'Piper Voice 1' },
            isDownloading: true,
            downloadProgress: 45,
            downloadStatus: 'Downloading models...'
        });

        render(<GlobalSettingsDialog />);
        fireEvent.click(screen.getByText('TTS Engine'));

        expect(screen.getByText('Downloading models...')).toBeInTheDocument();
        expect(screen.getByText('45%')).toBeInTheDocument();
        expect(screen.queryByText('Download Voice Data')).not.toBeInTheDocument();
    });

    it('triggers download on button click', () => {
        // @ts-expect-error Mock implementation
        useTTSStore.mockReturnValue({
            ...defaultStore,
            providerId: 'piper',
            voices: [{ id: 'piper:v1', name: 'Piper Voice 1' }],
            voice: { id: 'piper:v1', name: 'Piper Voice 1' },
        });

        render(<GlobalSettingsDialog />);
        fireEvent.click(screen.getByText('TTS Engine'));

        const btn = screen.getByText('Download Voice Data');
        fireEvent.click(btn);

        expect(mockDownloadVoice).toHaveBeenCalledWith('piper:v1');
    });
});
