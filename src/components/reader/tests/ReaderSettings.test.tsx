import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReaderSettings } from '../ReaderSettings';
import { useReaderStore } from '../../../store/useReaderStore';
import { useTTSStore } from '../../../store/useTTSStore';
import { vi, describe, it, expect } from 'vitest';

vi.mock('../../../store/useReaderStore');
vi.mock('../../../store/useTTSStore');

describe('ReaderSettings', () => {
    const mockOnClose = vi.fn();
    const mockSetTheme = vi.fn();
    const mockSetFontSize = vi.fn();
    const mockSetLineHeight = vi.fn();
    const mockSetFontFamily = vi.fn();
    const mockSetCustomTheme = vi.fn();
    const mockReset = vi.fn();
    const mockSetRate = vi.fn();
    const mockSetVoice = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (useReaderStore as any).mockReturnValue({
            currentTheme: 'light',
            setTheme: mockSetTheme,
            customTheme: { bg: '#ffffff', fg: '#000000' },
            setCustomTheme: mockSetCustomTheme,
            fontSize: 100,
            setFontSize: mockSetFontSize,
            fontFamily: 'serif',
            setFontFamily: mockSetFontFamily,
            lineHeight: 1.5,
            setLineHeight: mockSetLineHeight,
            reset: mockReset,
            currentBookId: 'book1'
        });
        (useTTSStore as any).mockReturnValue({
            rate: 1.0,
            setRate: mockSetRate,
            voice: { name: 'Voice 1', id: 'v1' },
            setVoice: mockSetVoice,
            voices: [{ name: 'Voice 1', id: 'v1' }, { name: 'Voice 2', id: 'v2' }]
        });
    });

    it('renders all sections', () => {
        render(<ReaderSettings onClose={mockOnClose} />);
        expect(screen.getByText('Display')).toBeInTheDocument();
        expect(screen.getByText('Audio')).toBeInTheDocument();
        expect(screen.getByText('System')).toBeInTheDocument();
    });

    it('calls setTheme when theme button clicked', () => {
        render(<ReaderSettings onClose={mockOnClose} />);
        fireEvent.click(screen.getByTestId('settings-theme-dark'));
        expect(mockSetTheme).toHaveBeenCalledWith('dark');
    });

    it('renders voice selection in Audio section', () => {
        render(<ReaderSettings onClose={mockOnClose} />);
        expect(screen.getByTestId('settings-voice-select')).toBeInTheDocument();
        expect(screen.getByText('Speed: 1x')).toBeInTheDocument();
    });

    it('renders system actions', () => {
        render(<ReaderSettings onClose={mockOnClose} />);
        expect(screen.getByTestId('settings-clear-storage-button')).toBeInTheDocument();
        expect(screen.getByTestId('settings-reset-button')).toBeInTheDocument();
    });
});
