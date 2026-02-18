import React from 'react';
import { render, screen } from '@testing-library/react';
import { TTSSettingsTab, TTSSettingsTabProps } from './TTSSettingsTab';
import { describe, it, expect, vi } from 'vitest';

describe('TTSSettingsTab Accessibility', () => {
    const defaultProps: TTSSettingsTabProps = {
        providerId: 'local',
        onProviderChange: vi.fn(),
        apiKeys: {},
        onApiKeyChange: vi.fn(),
        backgroundAudioMode: 'noise', // Enable noise mode to show the slider
        onBackgroundAudioModeChange: vi.fn(),
        whiteNoiseVolume: 0.5,
        onWhiteNoiseVolumeChange: vi.fn(),
        voice: null,
        voices: [],
        onVoiceChange: vi.fn(),
        isVoiceReady: true,
        isDownloading: false,
        downloadProgress: 0,
        downloadStatus: null,
        onDownloadVoice: vi.fn(),
        onDeleteVoice: vi.fn(),
        minSentenceLength: 50,
        onMinSentenceLengthChange: vi.fn(),
    };

    it('displays white noise volume with role="status" and aria-live="polite"', () => {
        render(<TTSSettingsTab {...defaultProps} />);

        // Find the percentage text
        const volumeText = screen.getByText('50%');
        expect(volumeText).toHaveAttribute('role', 'status');
        expect(volumeText).toHaveAttribute('aria-live', 'polite');
    });

    it('displays minimum sentence length with role="status" and aria-live="polite"', () => {
        render(<TTSSettingsTab {...defaultProps} />);

        // Find the char count text
        const lengthText = screen.getByText('50 chars');
        expect(lengthText).toHaveAttribute('role', 'status');
        expect(lengthText).toHaveAttribute('aria-live', 'polite');
    });
});
