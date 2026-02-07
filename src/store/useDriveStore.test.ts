import { describe, it, expect, beforeEach } from 'vitest';
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
