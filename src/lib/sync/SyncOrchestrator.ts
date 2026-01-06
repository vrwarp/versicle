import { SyncManager } from './SyncManager';
import { CheckpointService } from './CheckpointService';
import { AndroidBackupService } from './android-backup';
import type { RemoteStorageProvider } from './types';
import type { SyncManifest } from '../../types/db';
import { useSyncStore } from './hooks/useSyncStore';
import { getDB } from '../../db/db';
import { crdtService } from '../crdt/CRDTService';
import * as Y from 'yjs';

const DEBOUNCE_MS = 60000; // 60s

export class SyncOrchestrator {
    private provider: RemoteStorageProvider;
    private debounceTimer: NodeJS.Timeout | null = null;
    private isSyncing = false;
    private static instance: SyncOrchestrator | null = null;

    constructor(provider: RemoteStorageProvider) {
        this.provider = provider;
        SyncOrchestrator.instance = this;
    }

    static get(): SyncOrchestrator | null {
        return SyncOrchestrator.instance;
    }

    /**
     * Initializes the sync engine.
     * Should be called on app startup.
     */
    async initialize() {
        const { googleClientId, googleApiKey, isSyncEnabled } = useSyncStore.getState();

        if (isSyncEnabled && googleClientId && googleApiKey) {
            try {
                await this.provider.initialize({ clientId: googleClientId, apiKey: googleApiKey });
                console.log('Sync Provider Initialized');

                // Initial Pull
                await this.pullAndMerge();
            } catch (e) {
                console.error('Sync Initialization Failed', e);
            }
        }

        // Setup listeners
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.forcePush('background');
            }
        });

        // Listen for store changes to re-init
        useSyncStore.subscribe((state, prevState) => {
             if (state.googleClientId !== prevState.googleClientId ||
                 state.googleApiKey !== prevState.googleApiKey ||
                 state.isSyncEnabled !== prevState.isSyncEnabled) {

                 // If credentials changed, re-init.
                 // We don't have an un-init, but initialize handles idempotency or re-auth attempts.
                 if (state.isSyncEnabled) {
                    this.initialize();
                 }
             }
        });
    }

    /**
     * Restores the library state from a provided manifest.
     * Used for rollback/recovery.
     */
    async restoreFromManifest(manifest: SyncManifest): Promise<void> {
        console.log("Restoring from manifest (Recovery)...", manifest);
        await this.applyManifest(manifest);
        console.log("Restore complete.");
        // We might want to trigger a UI reload or refresh here, but DB changes are usually reactive or require reload.
        // For now, the UI (GlobalSettings) handles the reload/toast.
    }

    /**
     * Triggers a sync operation.
     * Uses debounce for frequent updates (e.g., reading progress).
     */
    scheduleSync() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);

        this.debounceTimer = setTimeout(() => {
            this.forcePush('debounce');
        }, DEBOUNCE_MS);
    }

    /**
     * Immediately triggers a push (e.g., on Pause).
     */
    async forcePush(trigger: string) {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        await this.performSync(trigger);
    }

    private async performSync(trigger: string) {
        if (this.isSyncing) return;
        const { isSyncEnabled } = useSyncStore.getState();
        if (!isSyncEnabled) return;

        this.isSyncing = true;
        try {
            console.log(`Starting Sync (${trigger})...`);

            // 1. Generate Local Manifest
            const localManifest = await this.generateLocalManifest();

            // 2. Create Checkpoint (Safety Net)
            await CheckpointService.createCheckpoint(localManifest, `pre-sync-${trigger}`);

            // 3. Get Remote Manifest
            let remoteManifest: SyncManifest | null = null;
            try {
                remoteManifest = await this.provider.getManifest();
            } catch (e) {
                console.warn("Failed to fetch remote manifest, assuming first push or offline.", e);
            }

            let finalManifest = localManifest;

            if (remoteManifest) {
                // 4. Merge
                finalManifest = SyncManager.mergeManifests(localManifest, remoteManifest);

                // 5. Apply Merged State Locally
                await this.applyManifest(finalManifest);
            }

            // 6. Push Merged State
            await this.provider.uploadManifest(finalManifest, remoteManifest?.version);

            // 7. Write to Android Backup
            await AndroidBackupService.writeBackupPayload(finalManifest);

            useSyncStore.getState().setLastSyncTime(Date.now());
            console.log('Sync Complete.');

        } catch (e) {
            console.error('Sync Failed', e);
        } finally {
            this.isSyncing = false;
        }
    }

    private async pullAndMerge() {
        await this.performSync('startup');
    }

    // --- Helpers to convert between DB and Manifest ---

    private async generateLocalManifest(): Promise<SyncManifest> {
        const db = await getDB();
        const books = await db.getAll('books');
        const readingHistory = await db.getAll('reading_history');
        const annotations = await db.getAll('annotations');
        const lexicon = await db.getAll('lexicon');
        const readingListList = await db.getAll('reading_list');
        const ttsPositions = await db.getAll('tts_position');

        const manifestBooks: SyncManifest['books'] = {};

        // Map books
        for (const b of books) {
            const hist = readingHistory.find(h => h.bookId === b.id) || {
                bookId: b.id,
                readRanges: [],
                sessions: [],
                lastUpdated: b.lastRead || 0
            };
            const ann = annotations.filter(a => a.bookId === b.id);

            manifestBooks[b.id] = {
                metadata: {
                    id: b.id,
                    title: b.title,
                    author: b.author,
                    lastRead: b.lastRead,
                    progress: b.progress,
                    // Minimal metadata
                },
                history: hist,
                annotations: ann
            };
        }

        const readingList: Record<string, any> = {};
        for (const rl of readingListList) {
            readingList[rl.filename] = rl;
        }

        const ttsPosMap: Record<string, any> = {};
        for (const tp of ttsPositions) {
            ttsPosMap[tp.bookId] = tp;
        }

        return {
            version: 1,
            lastUpdated: Date.now(),
            deviceId: 'browser', // TODO: Generate unique ID
            books: manifestBooks,
            lexicon,
            readingList,
            transientState: {
                ttsPositions: ttsPosMap
            },
            deviceRegistry: {}
        };
    }

    private async applyManifest(manifest: SyncManifest) {
        const db = await getDB();
        const tx = db.transaction(['books', 'reading_history', 'annotations', 'lexicon', 'reading_list', 'tts_position'], 'readwrite');

        // Prepare CRDT batch update (moved logic to end)

        // Since we need to read existing books from DB to merge metadata correctly (partial updates),
        // we'll do the DB operations and collect the final state to push to CRDT.
        const crdtUpdates: {
            books: any[],
            annotations: any[],
            history: any[],
            readingList: any[]
        } = { books: [], annotations: [], history: [], readingList: [] };

        for (const [bookId, data] of Object.entries(manifest.books)) {
            const existingBook = await tx.objectStore('books').get(bookId);
            if (existingBook) {
                const updated = { ...existingBook, ...data.metadata };
                await tx.objectStore('books').put(updated);
                crdtUpdates.books.push(updated);
            }

            if (data.history) {
                await tx.objectStore('reading_history').put(data.history);
                // CRDT History is Y.Array of strings (ranges)
                // We need to map readingHistory structure to it.
                // Currently MigrationService does: yArr.push(historyEntry.readRanges);
                crdtUpdates.history.push(data.history);
            }

            for (const ann of data.annotations) {
                await tx.objectStore('annotations').put(ann);
                crdtUpdates.annotations.push(ann);
            }
        }

        for (const rule of manifest.lexicon) {
            await tx.objectStore('lexicon').put(rule);
            // CRDT Lexicon TODO if needed
        }

        for (const entry of Object.values(manifest.readingList)) {
            await tx.objectStore('reading_list').put(entry);
            crdtUpdates.readingList.push(entry);
        }

        for (const pos of Object.values(manifest.transientState.ttsPositions)) {
             await tx.objectStore('tts_position').put(pos);
        }

        await tx.done;

        // Apply to CRDT
        crdtService.doc.transact(() => {
            for (const book of crdtUpdates.books) {
                crdtService.books.set(book.id, book);
            }
            for (const ann of crdtUpdates.annotations) {
                crdtService.annotations.set(ann.id, ann);
            }
            for (const hist of crdtUpdates.history) {
                // history is Map<BookID, Y.Array<string>>
                if (crdtService.history.has(hist.bookId)) {
                    const yArr = crdtService.history.get(hist.bookId);
                    if (yArr) yArr.delete(0, yArr.length);
                } else {
                    crdtService.history.set(hist.bookId, new Y.Array<string>());
                }
                const yArr = crdtService.history.get(hist.bookId);
                if (yArr) yArr.push(hist.readRanges);
            }
            for (const rl of crdtUpdates.readingList) {
                crdtService.readingList.set(rl.filename, rl);
            }
        });
    }
}
