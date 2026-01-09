import { SyncManager } from './SyncManager';
import { CheckpointService } from './CheckpointService';
import { AndroidBackupService } from './android-backup';
import type { RemoteStorageProvider } from './types';
import type { SyncManifest, BookState } from '../../types/db';
import { useSyncStore } from './hooks/useSyncStore';
import { getDB } from '../../db/db';

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
        const books = await db.getAll('static_books');
        const bookStates = await db.getAll('user_book_states');
        const readingHistory = await db.getAll('user_reading_history');
        const annotations = await db.getAll('user_annotations');
        const lexicon = await db.getAll('user_lexicon');
        const readingListList = await db.getAll('user_reading_list');
        const ttsPositions = await db.getAll('cache_tts_position');

        const manifestBooks: SyncManifest['books'] = {};
        const stateMap = new Map<string, BookState>(bookStates.map(s => [s.bookId, s]));

        // Map books
        for (const b of books) {
            // Ensure state exists or use fallback
            const state = stateMap.get(b.id) || { bookId: b.id };
            const hist = readingHistory.find(h => h.bookId === b.id) || {
                bookId: b.id,
                readRanges: [],
                sessions: [],
                lastUpdated: state.lastRead || 0
            };
            const ann = annotations.filter(a => a.bookId === b.id);

            manifestBooks[b.id] = {
                metadata: {
                    id: b.id,
                    title: b.title,
                    author: b.author,
                    lastRead: state.lastRead,
                    progress: state.progress,
                    // Minimal metadata to satisfy Sync
                },
                history: hist,
                annotations: ann
            };
        }

        const readingList: SyncManifest['readingList'] = {};
        for (const rl of readingListList) {
            readingList[rl.filename] = rl;
        }

        const ttsPosMap: SyncManifest['transientState']['ttsPositions'] = {};
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
        const tx = db.transaction([
            'static_books',
            'user_book_states',
            'user_reading_history',
            'user_annotations',
            'user_lexicon',
            'user_reading_list',
            'cache_tts_position'
        ], 'readwrite');

        // Apply Books (Metadata Updates)
        for (const [bookId, data] of Object.entries(manifest.books)) {
            const existingBook = await tx.objectStore('static_books').get(bookId);
            const existingState = await tx.objectStore('user_book_states').get(bookId);

            if (existingBook) {
                // Update Book (Identity) - limited fields
                if (data.metadata.title) existingBook.title = data.metadata.title;
                if (data.metadata.author) existingBook.author = data.metadata.author;
                await tx.objectStore('static_books').put(existingBook);

                // Update State (Progress)
                const newState: BookState = {
                    ...(existingState || { bookId }),
                    lastRead: data.metadata.lastRead,
                    progress: data.metadata.progress,
                    currentCfi: data.metadata.currentCfi,
                };
                // Ensure we don't overwrite if local is newer?
                // applyManifest assumes manifest is authoritative/merged.
                await tx.objectStore('user_book_states').put(newState);
            }
            // Note: We don't create new books from sync if we don't have the file!

            // Apply History
            if (data.history) {
                await tx.objectStore('user_reading_history').put(data.history);
            }

            // Apply Annotations
            for (const ann of data.annotations) {
                await tx.objectStore('user_annotations').put(ann);
            }
        }

        // Lexicon
        for (const rule of manifest.lexicon) {
            await tx.objectStore('user_lexicon').put(rule);
        }

        // Reading List
        for (const entry of Object.values(manifest.readingList)) {
            await tx.objectStore('user_reading_list').put(entry);
        }

        // TTS Positions
        for (const pos of Object.values(manifest.transientState.ttsPositions)) {
             await tx.objectStore('cache_tts_position').put(pos);
        }

        await tx.done;
    }
}
