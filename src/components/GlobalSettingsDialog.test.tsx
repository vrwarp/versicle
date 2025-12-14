import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GlobalSettingsDialog } from './GlobalSettingsDialog';
import { useTTSStore } from '../store/useTTSStore';

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

vi.mock('../store/useTTSStore', () => ({
    useTTSStore: vi.fn()
}));

describe('GlobalSettingsDialog - Piper TTS', () => {
    const defaultStore = {
        providerId: 'local',
        setProviderId: mockSetProviderId,
        apiKeys: {},
        setApiKey: vi.fn(),
        silentAudioType: 'silence',
        setSilentAudioType: vi.fn(),
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
