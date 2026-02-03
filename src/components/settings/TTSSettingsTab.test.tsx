import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TTSSettingsTab, TTSSettingsTabProps } from './TTSSettingsTab';

// Mock UI components
vi.mock('../ui/Select', () => ({
    Select: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange: (v: string) => void }) => (
        <div data-testid="select" data-value={value}>{children}</div>
    ),
    SelectTrigger: ({ children, id }: { children: React.ReactNode; id?: string }) => <button id={id}>{children}</button>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
        <div data-testid={`select-item-${value}`}>{children}</div>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>
}));

vi.mock('../ui/Slider', () => ({
    Slider: ({ value, onValueChange }: { value: number[]; onValueChange: (v: number[]) => void }) => (
        <input
            type="range"
            data-testid="slider"
            value={value[0]}
            onChange={(e) => onValueChange([Number(e.target.value)])}
        />
    )
}));

describe('TTSSettingsTab', () => {
    const defaultProps: TTSSettingsTabProps = {
        providerId: 'local',
        onProviderChange: vi.fn(),
        apiKeys: {},
        onApiKeyChange: vi.fn(),
        backgroundAudioMode: 'silence',
        onBackgroundAudioModeChange: vi.fn(),
        whiteNoiseVolume: 0.1,
        onWhiteNoiseVolumeChange: vi.fn(),
        voice: null,
        voices: [],
        onVoiceChange: vi.fn(),
        isVoiceReady: false,
        isDownloading: false,
        downloadProgress: 0,
        downloadStatus: null,
        onDownloadVoice: vi.fn(),
        onDeleteVoice: vi.fn(),
        minSentenceLength: 30,
        onMinSentenceLengthChange: vi.fn()
    };

    it('renders provider configuration section', () => {
        render(<TTSSettingsTab {...defaultProps} />);

        expect(screen.getByText('Provider Configuration')).toBeInTheDocument();
        expect(screen.getByText('Active Provider')).toBeInTheDocument();
    });

    it('renders background audio section', () => {
        render(<TTSSettingsTab {...defaultProps} />);

        expect(screen.getByText('Background Audio & Keep-Alive')).toBeInTheDocument();
        expect(screen.getByText('Mode')).toBeInTheDocument();
    });

    it('shows white noise volume when mode is noise', () => {
        render(<TTSSettingsTab {...defaultProps} backgroundAudioMode="noise" />);

        expect(screen.getByText('White Noise Volume')).toBeInTheDocument();
        expect(screen.getByText('10%')).toBeInTheDocument();
    });

    it('hides white noise volume when mode is not noise', () => {
        render(<TTSSettingsTab {...defaultProps} backgroundAudioMode="silence" />);

        expect(screen.queryByText('White Noise Volume')).not.toBeInTheDocument();
    });

    it('shows Piper voice selection when provider is piper', () => {
        render(
            <TTSSettingsTab
                {...defaultProps}
                providerId="piper"
                voices={[{ id: 'voice1', name: 'Voice 1', lang: 'en-US', provider: 'piper' }]}
            />
        );

        expect(screen.getByText('Select Voice')).toBeInTheDocument();
    });

    it('shows voice download status when voice is selected', () => {
        render(
            <TTSSettingsTab
                {...defaultProps}
                providerId="piper"
                voices={[{ id: 'voice1', name: 'Voice 1', lang: 'en-US', provider: 'piper' }]}
                voice={{ id: 'voice1', name: 'Voice 1', lang: 'en-US', provider: 'piper' }}
            />
        );

        expect(screen.getByText('Voice Data')).toBeInTheDocument();
        expect(screen.getByText('Not Downloaded')).toBeInTheDocument();
        expect(screen.getByText('Download Voice Data')).toBeInTheDocument();
    });

    it('shows download progress when downloading', () => {
        render(
            <TTSSettingsTab
                {...defaultProps}
                providerId="piper"
                voices={[{ id: 'voice1', name: 'Voice 1' }]}
                voice={{ id: 'voice1', name: 'Voice 1' }}
                isDownloading={true}
                downloadProgress={45}
                downloadStatus="Downloading..."
            />
        );

        expect(screen.getByText('Downloading...')).toBeInTheDocument();
        expect(screen.getByText('45%')).toBeInTheDocument();
    });

    it('shows Google API key input when provider is google', () => {
        render(<TTSSettingsTab {...defaultProps} providerId="google" />);

        expect(screen.getByLabelText('Google API Key')).toBeInTheDocument();
    });

    it('shows OpenAI API key input when provider is openai', () => {
        render(<TTSSettingsTab {...defaultProps} providerId="openai" />);

        expect(screen.getByLabelText('OpenAI API Key')).toBeInTheDocument();
    });

    it('shows LemonFox API key input when provider is lemonfox', () => {
        render(<TTSSettingsTab {...defaultProps} providerId="lemonfox" />);

        expect(screen.getByLabelText('LemonFox API Key')).toBeInTheDocument();
    });

    it('renders text processing section', () => {
        render(<TTSSettingsTab {...defaultProps} />);

        expect(screen.getByText('Text Processing')).toBeInTheDocument();
        expect(screen.getByText('Minimum Sentence Length')).toBeInTheDocument();
        expect(screen.getByText('30 chars')).toBeInTheDocument();
    });

    it('calls onDownloadVoice when download button clicked', () => {
        const onDownloadVoice = vi.fn();
        render(
            <TTSSettingsTab
                {...defaultProps}
                providerId="piper"
                voices={[{ id: 'voice1', name: 'Voice 1', lang: 'en-US', provider: 'piper' }]}
                voice={{ id: 'voice1', name: 'Voice 1', lang: 'en-US', provider: 'piper' }}
                onDownloadVoice={onDownloadVoice}
            />
        );

        fireEvent.click(screen.getByText('Download Voice Data'));
        expect(onDownloadVoice).toHaveBeenCalledWith('voice1');
    });

    it('calls onApiKeyChange when API key input changes', () => {
        const onApiKeyChange = vi.fn();
        render(<TTSSettingsTab {...defaultProps} providerId="google" onApiKeyChange={onApiKeyChange} />);

        fireEvent.change(screen.getByLabelText('Google API Key'), { target: { value: 'new-key' } });
        expect(onApiKeyChange).toHaveBeenCalledWith('google', 'new-key');
    });
});
