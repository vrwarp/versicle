/**
 * The Drive "Preview Cache" block: the occupancy readout and the manual
 * clear (confirm → drivePreviews.clear() → toast → re-read stats).
 *
 * Lives apart from SyncSettingsTab.test.tsx because it needs Drive
 * *connected* with a linked folder, while that suite pins the disconnected
 * shell — the module-level isServiceConnected mock can only be one or the
 * other.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncSettingsTab, type SyncSettingsTabProps } from './SyncSettingsTab';

const mockStats = vi.fn();
const mockClear = vi.fn();
const mockShowToast = vi.fn();
const mockConfirm = vi.fn();

vi.mock('@data/repos/drivePreviews', () => ({
    drivePreviews: {
        stats: (...args: unknown[]) => mockStats(...args),
        clear: (...args: unknown[]) => mockClear(...args),
    },
}));

vi.mock('../ui/ConfirmDialog', () => ({
    useConfirm: () => mockConfirm,
}));

vi.mock('@store/useToastStore', () => ({
    useToastStore: Object.assign(() => ({ showToast: mockShowToast }), {
        getState: () => ({ showToast: mockShowToast }),
    }),
}));

vi.mock('@store/useDriveStore', () => ({
    useDriveStore: Object.assign(
        () => ({
            linkedFolderName: 'books',
            setLinkedFolder: vi.fn(),
            trickleEnabled: false,
            setTrickleEnabled: vi.fn(),
            // 10 books on Drive — the denominator of the "N of M" readout.
            index: Array.from({ length: 10 }, (_, i) => ({ id: `f${i}` })),
        }),
        { getState: () => ({ clearLinkedFolder: vi.fn() }) },
    ),
}));

vi.mock('@store/useGoogleServicesStore', () => ({
    useGoogleServicesStore: Object.assign(
        () => ({
            isServiceConnected: () => true,
            googleClientId: 'web-id',
            googleIosClientId: 'ios-id',
            setGoogleClientId: vi.fn(),
            setGoogleIosClientId: vi.fn(),
        }),
        { getState: () => ({ isServiceConnected: () => true }) },
    ),
}));

const defaultProps: SyncSettingsTabProps = {
    currentDeviceId: 'device-123',
    currentDeviceName: 'My Device',
    onDeviceRename: vi.fn(),
    isFirebaseAvailable: false,
    firebaseAuthStatus: 'signed-out',
    firestoreStatus: 'disconnected',
    firebaseUserEmail: null,
    isFirebaseSigningIn: false,
    firebaseConfig: {
        apiKey: '',
        authDomain: '',
        projectId: '',
        storageBucket: '',
        messagingSenderId: '',
        appId: '',
    },
    onFirebaseConfigChange: vi.fn(),
    onFirebaseSignIn: vi.fn(),
    onFirebaseSignOut: vi.fn(),
    onClearConfig: vi.fn(),
};

const statsText = () => screen.getByTestId('drive-preview-cache-stats').textContent;
const clearButton = () => screen.getByRole('button', { name: /clear cache/i });

describe('SyncSettingsTab — Drive preview cache', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockStats.mockResolvedValue({ cached: 4, unextractable: 0, bytes: 2 * 1024 * 1024 });
        mockClear.mockResolvedValue({ deleted: 4, freedBytes: 2 * 1024 * 1024 });
        mockConfirm.mockResolvedValue(true);
    });

    it('reports cached count against the index size, plus bytes on disk', async () => {
        render(<SyncSettingsTab {...defaultProps} />);
        await waitFor(() => expect(statsText()).toContain('4 of 10 books cached'));
        expect(statsText()).toContain('2 MB');
    });

    it('surfaces unextractable rows so the shortfall is explained', async () => {
        mockStats.mockResolvedValue({ cached: 4, unextractable: 2, bytes: 1024 });
        render(<SyncSettingsTab {...defaultProps} />);
        await waitFor(() => expect(statsText()).toContain("2 couldn't be read"));
    });

    it('reads as empty — and offers nothing to clear — before anything is cached', async () => {
        mockStats.mockResolvedValue({ cached: 0, unextractable: 0, bytes: 0 });
        render(<SyncSettingsTab {...defaultProps} />);
        await waitFor(() => expect(statsText()).toBe('Nothing cached yet.'));
        expect(clearButton()).toBeDisabled();
    });

    it('clears on confirm, then re-reads the now-empty cache', async () => {
        render(<SyncSettingsTab {...defaultProps} />);
        await waitFor(() => expect(clearButton()).toBeEnabled());

        mockStats.mockResolvedValue({ cached: 0, unextractable: 0, bytes: 0 });
        fireEvent.click(clearButton());

        await waitFor(() => expect(mockClear).toHaveBeenCalledTimes(1));
        expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining('Cleared 4 previews'),
            'success',
        );
        await waitFor(() => expect(statsText()).toBe('Nothing cached yet.'));
    });

    it('does not clear when the confirm is declined', async () => {
        mockConfirm.mockResolvedValue(false);
        render(<SyncSettingsTab {...defaultProps} />);
        await waitFor(() => expect(clearButton()).toBeEnabled());

        fireEvent.click(clearButton());

        await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
        expect(mockClear).not.toHaveBeenCalled();
    });

    it('keeps the readout usable when the clear fails', async () => {
        mockClear.mockRejectedValue(new Error('idb exploded'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<SyncSettingsTab {...defaultProps} />);
        await waitFor(() => expect(clearButton()).toBeEnabled());

        fireEvent.click(clearButton());

        await waitFor(() =>
            expect(mockShowToast).toHaveBeenCalledWith(
                'Failed to clear the preview cache.',
                'error',
            ),
        );
        // Not stuck in the clearing state, and the stats re-read still ran.
        await waitFor(() => expect(clearButton()).toBeEnabled());
    });
});
