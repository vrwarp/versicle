import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useDriveStore } from './useDriveStore';

describe('useDriveStore', () => {
    beforeEach(() => {
        useDriveStore.getState().clearLinkedFolder();
    });

    it('sets linked folder', () => {
        useDriveStore.getState().setLinkedFolder('folder-123', 'My Books');

        const state = useDriveStore.getState();
        expect(state.linkedFolderId).toBe('folder-123');
        expect(state.linkedFolderName).toBe('My Books');
    });

    it('clears linked folder', () => {
        useDriveStore.getState().setLinkedFolder('folder-123', 'My Books');
        useDriveStore.getState().clearLinkedFolder();

        const state = useDriveStore.getState();
        expect(state.linkedFolderId).toBeNull();
        expect(state.linkedFolderName).toBeNull();
    });
});


/**
 * F9: the scanned `index` is persisted (5–6 fields per row, thousands of rows
 * possible) and zustand persist re-runs partialize + JSON.stringify and calls
 * `localStorage.setItem` SYNCHRONOUSLY after EVERY set — including
 * `setScanning(true)`, whose flag is not even in the allowlist. The deduped
 * storage (src/lib/persistStorage.ts) drops the commit when the payload is
 * byte-identical to the last one written.
 */
describe('regression: does not re-serialize the Drive index on unrelated writes', () => {
    const bigIndex = () =>
        Array.from({ length: 1000 }, (_, i) => ({
            id: `file-${i}`,
            name: `Book ${i}.epub`,
            size: 1_000_000 + i,
            modifiedTime: '2026-06-13T00:00:00.000Z',
            mimeType: 'application/epub+zip',
            md5Checksum: `md5-${i}`,
        }));

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('setScanning does not write the 1000-row index back to localStorage', () => {
        useDriveStore.getState().setScannedFiles(bigIndex());

        const setItem = vi.spyOn(window.localStorage, 'setItem');
        const writes = () => setItem.mock.calls.filter(([key]) => key === 'drive-config-storage').length;

        useDriveStore.getState().setScanning(true);
        useDriveStore.getState().setScanning(false);

        expect(writes()).toBe(0);
        expect(useDriveStore.getState().isScanning).toBe(false);
        expect(useDriveStore.getState().index).toHaveLength(1000);
    });

    it('a real index change is still persisted', () => {
        useDriveStore.getState().setScannedFiles(bigIndex());

        const setItem = vi.spyOn(window.localStorage, 'setItem');
        const writes = () => setItem.mock.calls.filter(([key]) => key === 'drive-config-storage').length;

        useDriveStore.getState().setScannedFiles(bigIndex().slice(0, 3));

        expect(writes()).toBe(1);
        const persisted = JSON.parse(localStorage.getItem('drive-config-storage')!);
        expect(persisted.state.index).toHaveLength(3);
    });
});
