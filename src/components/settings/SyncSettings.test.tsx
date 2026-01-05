import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncSettings } from './SyncSettings';
import { useSyncStore } from '../../store/useSyncStore';
import React from 'react';

// Mock Lucide icons
vi.mock('lucide-react', () => ({
    Cloud: () => <span data-testid="icon-cloud" />,
    CloudOff: () => <span data-testid="icon-cloud-off" />,
    RefreshCw: () => <span data-testid="icon-refresh" />,
    History: () => <span data-testid="icon-history" />,
}));

// Mock Store
const mockUseSyncStore = useSyncStore as unknown as ReturnType<typeof vi.fn>;
vi.mock('../../store/useSyncStore', () => ({
    useSyncStore: vi.fn(),
}));

describe('SyncSettings', () => {
    const mockActions = {
        authorize: vi.fn(),
        disconnect: vi.fn(),
        sync: vi.fn(),
        fetchCheckpoints: vi.fn(),
        restoreCheckpoint: vi.fn(),
        createCheckpoint: vi.fn(),
    };

    const defaultState = {
        isAuthorized: false,
        isSyncing: false,
        syncStatus: 'idle',
        lastSyncTime: null,
        errorMessage: null,
        checkpoints: [],
        ...mockActions,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockUseSyncStore.mockReturnValue(defaultState);
        // Mock window.confirm and alert
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        vi.spyOn(window, 'alert').mockImplementation(() => {});
        // Mock window.location.reload
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { reload: vi.fn() },
        });
    });

    it('should render in disconnected state by default', () => {
        render(<SyncSettings />);

        expect(screen.getByText('Cloud Synchronization')).toBeTruthy();
        expect(screen.getByText('Not Connected')).toBeTruthy();
        expect(screen.getByText('Connect')).toBeTruthy();
        expect(screen.queryByText('Sync Status')).toBeNull();
    });

    it('should call authorize when Connect is clicked', () => {
        render(<SyncSettings />);

        fireEvent.click(screen.getByText('Connect'));
        expect(mockActions.authorize).toHaveBeenCalled();
    });

    it('should render connected state', () => {
        mockUseSyncStore.mockReturnValue({
            ...defaultState,
            isAuthorized: true,
            lastSyncTime: 1600000000000,
            syncStatus: 'success',
        });

        render(<SyncSettings />);

        expect(screen.getByText('Connected to Google Drive')).toBeTruthy();
        expect(screen.getByText('Disconnect')).toBeTruthy();
        expect(screen.getByText('Sync Status')).toBeTruthy();
        expect(screen.getByText(/Last synced:/)).toBeTruthy();
    });

    it('should call sync when Sync Now is clicked', () => {
        mockUseSyncStore.mockReturnValue({
            ...defaultState,
            isAuthorized: true,
        });

        render(<SyncSettings />);

        fireEvent.click(screen.getByText('Sync Now'));
        expect(mockActions.sync).toHaveBeenCalled();
    });

    it('should render checkpoints list', () => {
        const checkpoints = [
            { timestamp: 1600000000000, reason: 'Auto', size: 1024, data: '{}' },
            { timestamp: 1500000000000, reason: 'Manual', size: 2048, data: '{}' },
        ];

        mockUseSyncStore.mockReturnValue({
            ...defaultState,
            checkpoints,
        });

        render(<SyncSettings />);

        expect(screen.getByText('Auto • 1 KB')).toBeTruthy();
        expect(screen.getByText('Manual • 2 KB')).toBeTruthy();
        expect(screen.getAllByText('Restore')).toHaveLength(2);
    });

    it('should handle restore checkpoint', async () => {
        const checkpoints = [
            { timestamp: 1600000000000, reason: 'Auto', size: 1024, data: '{}' }
        ];
         mockUseSyncStore.mockReturnValue({
            ...defaultState,
            checkpoints,
        });

        render(<SyncSettings />);

        fireEvent.click(screen.getByText('Restore'));

        expect(window.confirm).toHaveBeenCalled();
        expect(mockActions.restoreCheckpoint).toHaveBeenCalledWith(1600000000000);

        await waitFor(() => {
             expect(window.location.reload).toHaveBeenCalled();
        });
    });

     it('should handle manual checkpoint creation', () => {
        render(<SyncSettings />);

        fireEvent.click(screen.getByText('Create Checkpoint'));
        expect(mockActions.createCheckpoint).toHaveBeenCalledWith('Manual User Checkpoint');
    });
});
