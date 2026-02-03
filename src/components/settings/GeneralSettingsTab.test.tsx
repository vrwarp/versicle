import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { GeneralSettingsTab } from './GeneralSettingsTab';

// Mock ThemeSelector
vi.mock('../ThemeSelector', () => ({
    ThemeSelector: ({ currentTheme, onThemeChange }: { currentTheme: string; onThemeChange: (t: string) => void }) => (
        <div data-testid="theme-selector">
            <span>Current: {currentTheme}</span>
            <button onClick={() => onThemeChange('dark')}>Change Theme</button>
        </div>
    )
}));

describe('GeneralSettingsTab', () => {
    const defaultProps = {
        currentTheme: 'light',
        onThemeChange: vi.fn(),
        isImporting: false,
        importProgress: 0,
        importStatus: '',
        uploadProgress: 0,
        uploadStatus: '',
        onBatchImport: vi.fn()
    };

    it('renders appearance section with theme selector', () => {
        render(<GeneralSettingsTab {...defaultProps} />);

        expect(screen.getByText('Appearance')).toBeInTheDocument();
        expect(screen.getByText('Theme')).toBeInTheDocument();
        expect(screen.getByTestId('theme-selector')).toBeInTheDocument();
    });

    it('renders advanced import section', () => {
        render(<GeneralSettingsTab {...defaultProps} />);

        expect(screen.getByText('Advanced Import')).toBeInTheDocument();
        expect(screen.getByText('Import ZIP Archive')).toBeInTheDocument();
        expect(screen.getByText('Import Folder')).toBeInTheDocument();
    });

    it('disables import buttons when importing', () => {
        render(<GeneralSettingsTab {...defaultProps} isImporting={true} />);

        expect(screen.getByText('Import ZIP Archive')).toBeDisabled();
        expect(screen.getByText('Import Folder')).toBeDisabled();
    });

    it('shows import progress when importing', () => {
        render(
            <GeneralSettingsTab
                {...defaultProps}
                isImporting={true}
                uploadProgress={50}
                uploadStatus="Uploading..."
            />
        );

        expect(screen.getByText('Uploading...')).toBeInTheDocument();
    });

    it('shows import status when upload complete', () => {
        render(
            <GeneralSettingsTab
                {...defaultProps}
                isImporting={true}
                uploadProgress={100}
                importProgress={30}
                importStatus="Processing book 1 of 3..."
            />
        );

        expect(screen.getByText('Processing book 1 of 3...')).toBeInTheDocument();
    });

    it('calls onThemeChange when theme is changed', () => {
        const onThemeChange = vi.fn();
        render(<GeneralSettingsTab {...defaultProps} onThemeChange={onThemeChange} />);

        fireEvent.click(screen.getByText('Change Theme'));
        expect(onThemeChange).toHaveBeenCalledWith('dark');
    });

    it('triggers file input when ZIP button clicked', () => {
        render(<GeneralSettingsTab {...defaultProps} />);

        const zipInput = screen.getByTestId('zip-import-input');
        const clickSpy = vi.spyOn(zipInput, 'click');

        fireEvent.click(screen.getByText('Import ZIP Archive'));
        expect(clickSpy).toHaveBeenCalled();
    });

    it('calls onBatchImport when files selected', () => {
        const onBatchImport = vi.fn();
        render(<GeneralSettingsTab {...defaultProps} onBatchImport={onBatchImport} />);

        const zipInput = screen.getByTestId('zip-import-input');
        const file = new File(['content'], 'test.zip', { type: 'application/zip' });

        Object.defineProperty(zipInput, 'files', {
            value: [file]
        });

        fireEvent.change(zipInput);
        expect(onBatchImport).toHaveBeenCalled();
    });
});
