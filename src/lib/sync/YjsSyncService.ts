import * as Y from 'yjs';
import { yDoc, waitForYjsSync } from '../../store/yjs-provider';
import type { RemoteStorageProvider } from './types';
import { useSyncStore } from './hooks/useSyncStore';
import { getDB } from '../../db/db';
import type { LexiconRule, UserOverrides } from '../../types/db';

const DEBOUNCE_MS = 60000; // 60s

/**
 * Yjs-based Sync Service
 * 
 * Replaces the legacy SyncOrchestrator with a simpler approach:
 * - Uses Y.encodeStateAsUpdate() to capture entire CRDT state
 * - Uses Y.applyUpdate() for proper CRDT merging
 * - No manual merge logic needed - Yjs handles conflicts automatically
 */
export class YjsSyncService {
    private provider: RemoteStorageProvider;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private isSyncing = false;
    private static instance: YjsSyncService | null = null;

    constructor(provider: RemoteStorageProvider) {
        this.provider = provider;
        YjsSyncService.instance = this;
    }

    static get(): YjsSyncService | null {
        return YjsSyncService.instance;
    }

    /**
     * Initialize the sync service and perform initial sync
     */
    async initialize(): Promise<void> {
        const { googleClientId, googleApiKey, isSyncEnabled } = useSyncStore.getState();

        if (isSyncEnabled && googleClientId && googleApiKey) {
            try {
                await this.provider.initialize({ clientId: googleClientId, apiKey: googleApiKey });
                console.log('[YjsSync] Provider initialized');

                // Perform initial pull to get remote state
                await this.sync('startup');
            } catch (e) {
                console.error('[YjsSync] Initialization failed', e);
            }
        }

        // Handle visibility change - push when going to background
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.forcePush('background');
            }
        });

        // React to sync settings changes
        useSyncStore.subscribe((state, prevState) => {
            if (state.googleClientId !== prevState.googleClientId ||
                state.googleApiKey !== prevState.googleApiKey ||
                state.isSyncEnabled !== prevState.isSyncEnabled) {
                if (state.isSyncEnabled) {
                    this.initialize();
                }
            }
        });
    }

    /**
     * Schedule a debounced sync
     */
    scheduleSync(): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.forcePush('debounce');
        }, DEBOUNCE_MS);
    }

    /**
     * Force an immediate push
     */
    async forcePush(trigger: string): Promise<void> {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        await this.push(trigger);
    }

    /**
     * Full bidirectional sync: pull first, then push
     */
    async sync(trigger: string): Promise<void> {
        if (this.isSyncing) return;

        const { isSyncEnabled } = useSyncStore.getState();
        if (!isSyncEnabled) return;

        this.isSyncing = true;
        try {
            console.log(`[YjsSync] Starting sync (${trigger})...`);

            // Pull first to get any remote changes
            await this.pull();

            // Then push our state (merged with remote)
            await this.push(trigger);

            useSyncStore.getState().setLastSyncTime(Date.now());
            console.log('[YjsSync] Sync complete');
        } catch (e) {
            console.error('[YjsSync] Sync failed', e);
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Pull remote Yjs snapshot and merge into local state
     */
    private async pull(): Promise<void> {
        try {
            const remoteSnapshot = await this.provider.downloadSnapshot();

            if (remoteSnapshot) {
                console.log(`[YjsSync] Applying remote snapshot (${remoteSnapshot.byteLength} bytes)`);

                // Y.applyUpdate merges using CRDT semantics
                // This automatically handles conflicts via vector clocks
                Y.applyUpdate(yDoc, remoteSnapshot);

                // Restore Lexicon (Yjs -> IDB)
                await this.restoreLexiconFromYjs();

                // Middleware automatically syncs Yjs → Zustand stores
                await new Promise(resolve => setTimeout(resolve, 100));
            } else {
                console.log('[YjsSync] No remote snapshot found');
            }
        } catch (e) {
            console.warn('[YjsSync] Pull failed (continuing with push)', e);
        }
    }

    /**
     * Push local Yjs state as snapshot to remote
     */
    private async push(trigger: string): Promise<void> {
        // Ensure Yjs is synced from IndexedDB
        await waitForYjsSync();

        // Sync Lexicon (IDB -> Yjs)
        await this.syncLexicon();

        // Capture entire Y.Doc state
        const snapshot = Y.encodeStateAsUpdate(yDoc);
        console.log(`[YjsSync] Pushing snapshot (${snapshot.byteLength} bytes, trigger: ${trigger})`);

        await this.provider.uploadSnapshot(snapshot);
    }

    /**
     * Sync lexicon rules separately (stored in IDB, not Yjs)
     * This is needed because lexicon is in user_overrides which isn't in Yjs
     */
    async syncLexicon(): Promise<void> {
        const db = await getDB();
        const overrides: UserOverrides[] = await db.getAll('user_overrides');

        // Flatten to LexiconRule array
        const lexicon: LexiconRule[] = [];
        for (const ov of overrides) {
            for (const r of ov.lexicon) {
                lexicon.push({
                    id: r.id,
                    original: r.original,
                    replacement: r.replacement,
                    isRegex: r.isRegex,
                    created: r.created,
                    bookId: ov.bookId === 'global' ? undefined : ov.bookId,
                });
            }
        }

        // Store lexicon in a Yjs map for sync
        const lexiconMap = yDoc.getMap<LexiconRule>('lexicon');
        for (const rule of lexicon) {
            lexiconMap.set(rule.id, rule);
        }
    }


    /**
     * Restore lexicon rules from Yjs back to IDB
     */
    async restoreLexiconFromYjs(): Promise<void> {
        const lexiconMap = yDoc.getMap<LexiconRule>('lexicon');
        const rules = Array.from(lexiconMap.values());

        if (rules.length === 0) return;

        console.log(`[YjsSync] Restoring ${rules.length} lexicon rules from sync`);

        const db = await getDB();
        const tx = db.transaction('user_overrides', 'readwrite');

        // Group by bookId
        const byBookId: Record<string, LexiconRule[]> = {};

        for (const rule of rules) {
            const bookId = rule.bookId || 'global';
            if (!byBookId[bookId]) byBookId[bookId] = [];
            byBookId[bookId].push(rule);
        }

        for (const [bookId, bookRules] of Object.entries(byBookId)) {
            const existing = await tx.store.get(bookId) || {
                bookId,
                lexicon: [],
                // created/modified not part of UserOverrides type
            };

            // Merge rules
            const existingMap = new Map(existing.lexicon.map(r => [r.id, r]));

            for (const r of bookRules) {
                existingMap.set(r.id, r);
            }

            existing.lexicon = Array.from(existingMap.values());
            // existing.modified = Date.now();

            await tx.store.put(existing);
        }

        await tx.done;
    }
}
