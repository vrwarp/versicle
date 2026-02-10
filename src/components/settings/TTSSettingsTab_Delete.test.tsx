import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TTSSettingsTab, TTSSettingsTabProps } from './TTSSettingsTab';

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

interface DialogMockProps {
    isOpen: boolean;
    title: string;
    description: string;
    children: React.ReactNode;
    footer: React.ReactNode;
}

vi.mock('../ui/Dialog', () => ({
    Dialog: ({ isOpen, title, description, children, footer }: DialogMockProps) => isOpen ? (
        <div data-testid="dialog">
            <h1>{title}</h1>
            <p>{description}</p>
            <div>{children}</div>
            <div>{footer}</div>
        </div>
    ) : null
}));

describe('TTSSettingsTab Delete Flow', () => {
    const defaultProps: TTSSettingsTabProps = {
        providerId: 'piper',
        onProviderChange: vi.fn(),
        apiKeys: {},
        onApiKeyChange: vi.fn(),
        backgroundAudioMode: 'silence',
        onBackgroundAudioModeChange: vi.fn(),
        whiteNoiseVolume: 0.1,
        onWhiteNoiseVolumeChange: vi.fn(),
        voice: { id: 'voice1', name: 'Voice 1', lang: 'en-US', provider: 'piper' },
        voices: [{ id: 'voice1', name: 'Voice 1', lang: 'en-US', provider: 'piper' }],
        onVoiceChange: vi.fn(),
        isVoiceReady: true,
        isDownloading: false,
        downloadProgress: 0,
        downloadStatus: null,
        onDownloadVoice: vi.fn(),
        onDeleteVoice: vi.fn(),
        minSentenceLength: 30,
        onMinSentenceLengthChange: vi.fn()
    };

    it('opens dialog instead of calling window.confirm on delete click', () => {
        const confirmSpy = vi.spyOn(window, 'confirm');
        render(<TTSSettingsTab {...defaultProps} />);

        // Click delete button
        const deleteBtn = screen.getByLabelText('Delete Voice Data');
        fireEvent.click(deleteBtn);

        // Assert confirm was NOT called
        expect(confirmSpy).not.toHaveBeenCalled();

        // Assert Dialog is open
        expect(screen.getByTestId('dialog')).toBeInTheDocument();
        expect(screen.getByText('Delete Voice Data')).toBeInTheDocument();
        expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();
    });

    it('calls onDeleteVoice when confirm button in dialog is clicked', () => {
        const onDeleteVoice = vi.fn();
        render(<TTSSettingsTab {...defaultProps} onDeleteVoice={onDeleteVoice} />);

        // Open dialog
        fireEvent.click(screen.getByLabelText('Delete Voice Data'));

        // Click confirm
        fireEvent.click(screen.getByTestId('confirm-delete-voice'));

        // Assert callback
        expect(onDeleteVoice).toHaveBeenCalledWith('voice1');
    });

    it('closes dialog when cancel is clicked', () => {
        const onDeleteVoice = vi.fn();
        render(<TTSSettingsTab {...defaultProps} onDeleteVoice={onDeleteVoice} />);

        // Open dialog
        fireEvent.click(screen.getByLabelText('Delete Voice Data'));

        // Click cancel
        fireEvent.click(screen.getByText('Cancel'));

        // Assert dialog closed
        expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
        expect(onDeleteVoice).not.toHaveBeenCalled();
    });
});
