import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface DriveFileIndex {
    id: string;
    name: string;
    size: number;
    modifiedTime: string;
    mimeType: string;
}

interface DriveConfigState {
    // The folder Versicle is "watching"
    linkedFolderId: string | null;
    linkedFolderName: string | null;

    // Index
    index: DriveFileIndex[];
    lastScanTime: number | null;
    isScanning: boolean;

    // Actions
    setLinkedFolder: (id: string, name: string) => void;
    clearLinkedFolder: () => void;

    setScannedFiles: (files: DriveFileIndex[]) => void;
    setScanning: (isScanning: boolean) => void;

    // Heuristic finder (client-side)
    findFile: (bookTitle: string, filename?: string) => DriveFileIndex | undefined;
}

export const useDriveStore = create<DriveConfigState>()(
    persist(
        (set, get) => ({
            linkedFolderId: null,
            linkedFolderName: null,

            index: [],
            lastScanTime: null,
            isScanning: false,

            setLinkedFolder: (id, name) => set({ linkedFolderId: id, linkedFolderName: name }),
            clearLinkedFolder: () => set({
                linkedFolderId: null,
                linkedFolderName: null,
                index: [],
                lastScanTime: null
            }),

            setScannedFiles: (files) => set({
                index: files,
                lastScanTime: Date.now(),
                isScanning: false
            }),

            setScanning: (isScanning) => set({ isScanning }),

            findFile: (bookTitle: string, filename?: string) => {
                const { index } = get();
                // 1. Exact filename match (strongest signal)
                if (filename) {
                    const exact = index.find(f => f.name === filename);
                    if (exact) return exact;
                }

                // 2. Title containment (simple fuzzy)
                // Normalize: "Project Hail Mary" -> "project hail mary"
                const normalizedTitle = bookTitle.toLowerCase();
                return index.find(f => f.name.toLowerCase().includes(normalizedTitle));
            }
        }),
        {
            name: 'drive-config-storage',
            partialize: (state) => ({
                linkedFolderId: state.linkedFolderId,
                linkedFolderName: state.linkedFolderName,
                index: state.index,
                lastScanTime: state.lastScanTime
            })
        }
    )
);
