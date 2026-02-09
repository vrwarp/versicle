import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DriveImportDialog } from './DriveImportDialog';
import { useDriveStore } from '../../store/useDriveStore';
import { vi, describe, it, expect, beforeEach, Mock } from 'vitest';

// Mock dependencies
vi.mock('../../store/useDriveStore');
vi.mock('../../lib/drive/DriveScannerService', () => ({
    DriveScannerService: {
        scanAndIndex: vi.fn(),
        importFile: vi.fn(),
    }
}));
vi.mock('../../store/useToastStore', () => ({
    useToastStore: () => vi.fn(),
}));

// Mock UI components if necessary, but RTL handles standard HTML well.
// We might need to mock Modal if it uses portals that JSDOM doesn't like,
// but usually Radix UI works fine in tests if properly setup.
// To be safe, we can mock the Modal to just render children.

vi.mock('../ui/Modal', () => ({
    Modal: ({ children, open }: { children: React.ReactNode, open: boolean }) => open ? <div>{children}</div> : null,
    ModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ModalHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ModalTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ModalDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('DriveImportDialog', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        // Setup default store state
        (useDriveStore as unknown as Mock).mockReturnValue({
            index: [],
            lastScanTime: Date.now(),
            isScanning: false,
        });
    });

    it('renders the Manual Sync button', () => {
        render(<DriveImportDialog isOpen={true} onClose={() => {}} />);

        expect(screen.getByText('Manual Sync')).toBeInTheDocument();
    });

    it('calls scanAndIndex when Manual Sync is clicked', async () => {
        const { DriveScannerService } = await import('../../lib/drive/DriveScannerService');

        render(<DriveImportDialog isOpen={true} onClose={() => {}} />);

        const syncButton = screen.getByText('Manual Sync');
        fireEvent.click(syncButton);

        expect(DriveScannerService.scanAndIndex).toHaveBeenCalled();
    });

    it('shows Syncing state when isScanning is true', () => {
        (useDriveStore as unknown as Mock).mockReturnValue({
            index: [],
            lastScanTime: Date.now(),
            isScanning: true,
        });

        render(<DriveImportDialog isOpen={true} onClose={() => {}} />);

        expect(screen.getByText('Syncing...')).toBeInTheDocument();
        expect(screen.queryByText('Manual Sync')).not.toBeInTheDocument();
    });
});
