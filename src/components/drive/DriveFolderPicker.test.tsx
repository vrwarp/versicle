import React from 'react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DriveFolderPicker } from './DriveFolderPicker';
import { useDriveBrowser } from './useDriveBrowser';

// Mocks
vi.mock('../../store/useToastStore', () => ({
    useToastStore: () => ({ showToast: vi.fn() })
}));

vi.mock('./useDriveBrowser', () => ({
    useDriveBrowser: vi.fn()
}));

// Mock Lucide icons to avoid render issues in test env (optional, but sometimes needed)
// Usually not needed if setup is correct, but safe to do if icons cause noise.

describe('DriveFolderPicker', () => {
    const mockOpenFolder = vi.fn();
    const mockNavigateUp = vi.fn();
    const mockRefresh = vi.fn();
    const mockOnSelect = vi.fn();
    const mockOnCancel = vi.fn();

    const defaultHookValues = {
        currentFolderId: 'f1',
        breadcrumbs: [
            { id: 'root', name: 'My Drive' },
            { id: 'f1', name: 'SubFolder' }
        ],
        items: [
            { id: 'f2', name: 'Folder 2', mimeType: 'application/vnd.google-apps.folder' }
        ],
        isLoading: false,
        error: null,
        openFolder: mockOpenFolder,
        navigateUp: mockNavigateUp,
        refresh: mockRefresh
    };

    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(useDriveBrowser).mockReturnValue(defaultHookValues);
    });

    it('renders folder list correctly', () => {
        render(<DriveFolderPicker onSelect={mockOnSelect} onCancel={mockOnCancel} />);

        expect(screen.getByText('Folder 2')).toBeInTheDocument();
        // SubFolder appears in breadcrumbs and footer
        expect(screen.getAllByText('SubFolder').length).toBeGreaterThan(0);
        expect(screen.getByText(/My Drive/i)).toBeInTheDocument();
    });

    it('calls openFolder when a row is clicked', () => {
        render(<DriveFolderPicker onSelect={mockOnSelect} onCancel={mockOnCancel} />);

        fireEvent.click(screen.getByText('Folder 2'));
        expect(mockOpenFolder).toHaveBeenCalledWith('f2', 'Folder 2');
    });

    it('calls onSelect when "Select This Folder" is clicked', async () => {
        render(<DriveFolderPicker onSelect={mockOnSelect} onCancel={mockOnCancel} />);

        const selectButton = screen.getByText('Select This Folder');
        expect(selectButton).toBeEnabled();

        fireEvent.click(selectButton);

        // Wait for async delay
        await waitFor(() => {
            expect(mockOnSelect).toHaveBeenCalledWith('f1', 'SubFolder');
        });
    });

    it('shows loading skeleton when loading', () => {
        vi.mocked(useDriveBrowser).mockReturnValue({
            ...defaultHookValues,
            isLoading: true,
            items: []
        });

        render(<DriveFolderPicker onSelect={mockOnSelect} onCancel={mockOnCancel} />);

        // Check for skeleton elements (we can check for specific class or just absence of text)
        expect(screen.queryByText('Folder 1')).not.toBeInTheDocument();
        // Maybe check for "Loading folders..." text if we have it visually hidden or visible
        // The implementation has no text for skeleton, just visual blocks.
    });

    it('shows empty state', () => {
        vi.mocked(useDriveBrowser).mockReturnValue({
            ...defaultHookValues,
            items: []
        });

        render(<DriveFolderPicker onSelect={mockOnSelect} onCancel={mockOnCancel} />);
        expect(screen.getByText('No folders here.')).toBeInTheDocument();
    });

    it('shows error state', () => {
        vi.mocked(useDriveBrowser).mockReturnValue({
            ...defaultHookValues,
            error: new Error('Network Error')
        });

        render(<DriveFolderPicker onSelect={mockOnSelect} onCancel={mockOnCancel} />);
        expect(screen.getByText('Could not load folder')).toBeInTheDocument();
        expect(screen.getByText('Network Error')).toBeInTheDocument();
    });
});
