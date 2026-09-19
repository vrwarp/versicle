import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createDedupedJSONStorage } from '@lib/persistStorage';

export interface DriveFileIndex {
    id: string;
    name: string;
    size: number;
    modifiedTime: string;
    mimeType: string;
    /**
     * Drive content MD5 (blob files only). The cache key half for
     * partial-fetch metadata/cover previews: a re-uploaded file keeps its id
     * but changes md5, invalidating a stale preview. Optional — indexes
     * scanned before this field existed lack it until the next scan.
     */
    md5Checksum?: string;
}

interface DriveConfigState {
    // The folder Versicle is "watching"
    linkedFolderId: string | null;
    linkedFolderName: string | null;

    // Index
    index: DriveFileIndex[];
    lastScanTime: number | null;
    isScanning: boolean;

    /**
     * R7 opt-in: build rich Drive previews (covers + metadata) in the
     * background. Default OFF — trickle hydration is continuous ranged egress
     * of book bytes over any connection, so it is a deliberate choice, not the
     * auto-scan default. Persisted.
     */
    trickleEnabled: boolean;

    // Actions
    setLinkedFolder: (id: string, name: string) => void;
    clearLinkedFolder: () => void;

    setScannedFiles: (files: DriveFileIndex[]) => void;
    setScanning: (isScanning: boolean) => void;
    setTrickleEnabled: (enabled: boolean) => void;

    // Heuristic finder (client-side)
    findFile: (bookTitle: string, filename?: string) => DriveFileIndex | undefined;
}

/** The persisted slice (the partialize allowlist below). */
type PersistedDriveState = Pick<
    DriveConfigState,
    'linkedFolderId' | 'linkedFolderName' | 'index' | 'lastScanTime' | 'trickleEnabled'
>;

export const useDriveStore = create<DriveConfigState>()(
    persist(
        (set, get) => ({
            linkedFolderId: null,
            linkedFolderName: null,

            index: [],
            lastScanTime: null,
            isScanning: false,
            trickleEnabled: false,

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
            setTrickleEnabled: (enabled) => set({ trickleEnabled: enabled }),

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
            // Deduped COMMITS: the scanned `index` (one row per Drive file —
            // thousands are possible) is in the allowlist below, and persist
            // re-runs partialize + JSON.stringify + a synchronous
            // localStorage.setItem after EVERY set — `setScanning(true)`
            // included, although `isScanning` is not persisted at all. The
            // wrapper sits BELOW createJSONStorage, so partialize and the
            // stringify still run on that set; what disappears is the storage
            // commit of the whole index for a payload that did not change.
            storage: createDedupedJSONStorage<PersistedDriveState>(),
            partialize: (state): PersistedDriveState => ({
                linkedFolderId: state.linkedFolderId,
                linkedFolderName: state.linkedFolderName,
                index: state.index,
                lastScanTime: state.lastScanTime,
                trickleEnabled: state.trickleEnabled
            })
        }
    )
);
