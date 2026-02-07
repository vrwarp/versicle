import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DriveConfigState {
    // The folder Versicle is "watching"
    linkedFolderId: string | null;
    linkedFolderName: string | null;

    // Actions
    setLinkedFolder: (id: string, name: string) => void;
    clearLinkedFolder: () => void;
}

export const useDriveStore = create<DriveConfigState>()(
    persist(
        (set) => ({
            linkedFolderId: null,
            linkedFolderName: null,
            setLinkedFolder: (id, name) => set({ linkedFolderId: id, linkedFolderName: name }),
            clearLinkedFolder: () => set({ linkedFolderId: null, linkedFolderName: null }),
        }),
        { name: 'drive-config-storage' }
    )
);
