import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TTSSettingsTab, type TTSSettingsTabProps } from './TTSSettingsTab';

// Mock UI components
vi.mock('../ui/Select', () => ({
    Select: ({ children, value }: { children: React.ReactNode; value: string; onValueChange: (v: string) => void }) => (
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
        activeLanguage: 'en',
        profiles: { en: { voiceId: 'voice1', rate: 1.0, pitch: 1.0, volume: 1.0 } },
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
                voices={[{ id: 'voice1', name: 'Voice 1', lang: 'en-US', provider: 'piper' }]}
                voice={{ id: 'voice1', name: 'Voice 1', lang: 'en-US', provider: 'piper' }}
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
        expect(screen.getByText('36 chars')).toBeInTheDocument();
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

    describe('buffered API-key edits (5a: the keystroke provider-rebuild is dead)', () => {
        it('typing into the key field commits nothing — no provider construction per keystroke', () => {
            const onApiKeyChange = vi.fn();
            render(<TTSSettingsTab {...defaultProps} providerId="google" onApiKeyChange={onApiKeyChange} />);

            const input = screen.getByLabelText('Google API Key');
            fireEvent.change(input, { target: { value: 'n' } });
            fireEvent.change(input, { target: { value: 'ne' } });
            fireEvent.change(input, { target: { value: 'new-key' } });

            expect(onApiKeyChange).not.toHaveBeenCalled();
        });

        it('blur commits the buffered key exactly once', () => {
            const onApiKeyChange = vi.fn();
            render(<TTSSettingsTab {...defaultProps} providerId="google" onApiKeyChange={onApiKeyChange} />);

            const input = screen.getByLabelText('Google API Key');
            fireEvent.change(input, { target: { value: 'new-key' } });
            fireEvent.blur(input);

            expect(onApiKeyChange).toHaveBeenCalledTimes(1);
            expect(onApiKeyChange).toHaveBeenCalledWith('google', 'new-key');
        });

        it('blur without an actual edit commits nothing', () => {
            const onApiKeyChange = vi.fn();
            render(
                <TTSSettingsTab
                    {...defaultProps}
                    providerId="google"
                    apiKeys={{ google: 'existing' }}
                    onApiKeyChange={onApiKeyChange}
                />,
            );

            fireEvent.blur(screen.getByLabelText('Google API Key'));
            expect(onApiKeyChange).not.toHaveBeenCalled();
        });

        it('the explicit "Test Key" button commits the draft and runs the key test', () => {
            const onApiKeyChange = vi.fn();
            const onTestApiKey = vi.fn();
            render(
                <TTSSettingsTab
                    {...defaultProps}
                    providerId="google"
                    onApiKeyChange={onApiKeyChange}
                    onTestApiKey={onTestApiKey}
                />,
            );

            fireEvent.change(screen.getByLabelText('Google API Key'), { target: { value: 'probe-key' } });
            fireEvent.click(screen.getByTestId('tts-google-test-key'));

            expect(onApiKeyChange).toHaveBeenCalledWith('google', 'probe-key');
            expect(onTestApiKey).toHaveBeenCalledWith('google', 'probe-key');
        });
    });

    it('renders the provider choices from the registry (single source of truth)', () => {
        render(<TTSSettingsTab {...defaultProps} />);

        // jsdom is the web platform: device provider surfaces under 'local'.
        expect(screen.getByTestId('select-item-local')).toHaveTextContent('Web Speech (Local)');
        expect(screen.getByTestId('select-item-piper')).toHaveTextContent('Piper (High Quality Local)');
        expect(screen.getByTestId('select-item-google')).toHaveTextContent('Google Cloud TTS');
        expect(screen.getByTestId('select-item-openai')).toHaveTextContent('OpenAI');
        expect(screen.getByTestId('select-item-lemonfox')).toHaveTextContent('LemonFox.ai');
    });
});
