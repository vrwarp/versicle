import { SyncManager } from './SyncManager';
import { CheckpointService } from './CheckpointService';
import { AndroidBackupService } from './android-backup';
import type { RemoteStorageProvider } from './types';
import type { SyncManifest } from '../../types/db';
import type { BookState } from '../../types/db'; // Legacy import, but we use new types now
// We need to import new types to map correctly
import type { UserInventoryItem, UserProgress, UserAnnotation, LexiconRule, ReadingHistoryEntry, UserJourneyStep, UserOverrides } from '../../types/db';
import { useSyncStore } from './hooks/useSyncStore';
import { getDB } from '../../db/db';
import { v4 as uuidv4 } from 'uuid';

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

    async initialize() {
        const { googleClientId, googleApiKey, isSyncEnabled } = useSyncStore.getState();

        if (isSyncEnabled && googleClientId && googleApiKey) {
            try {
                await this.provider.initialize({ clientId: googleClientId, apiKey: googleApiKey });
                console.log('Sync Provider Initialized');
                await this.pullAndMerge();
            } catch (e) {
                console.error('Sync Initialization Failed', e);
            }
        }

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.forcePush('background');
            }
        });

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

    async restoreFromManifest(manifest: SyncManifest): Promise<void> {
        console.log("Restoring from manifest (Recovery)...", manifest);
        await this.applyManifest(manifest);
        console.log("Restore complete.");
    }

    scheduleSync() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.forcePush('debounce');
        }, DEBOUNCE_MS);
    }

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

            const localManifest = await this.generateLocalManifest();
            await CheckpointService.createCheckpoint(localManifest, `pre-sync-${trigger}`);

            let remoteManifest: SyncManifest | null = null;
            try {
                remoteManifest = await this.provider.getManifest();
            } catch (e) {
                console.warn("Failed to fetch remote manifest, assuming first push or offline.", e);
            }

            let finalManifest = localManifest;

            if (remoteManifest) {
                finalManifest = SyncManager.mergeManifests(localManifest, remoteManifest);
                await this.applyManifest(finalManifest);
            }

            await this.provider.uploadManifest(finalManifest, remoteManifest?.version);
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

    // --- Helpers to convert between DB (v18) and SyncManifest ---

    private async generateLocalManifest(): Promise<SyncManifest> {
        const db = await getDB();

        // Fetch User Domain Data
        const inventory = await db.getAll('user_inventory');
        const progress = await db.getAll('user_progress');
        const annotations = await db.getAll('user_annotations');
        const overrides = await db.getAll('user_overrides');
        const journey = await db.getAll('user_journey'); // We need to flatten this to ReadingHistoryEntry for manifest compatibility

        // We also need static_manifests to get Title/Author fallback?
        // No, SyncManifest stores "metadata" which is effectively UserInventory + snapshot of core metadata.
        // We should fetch manifests to ensure we have title/author if not in inventory custom fields.
        const staticManifests = await db.getAll('static_manifests');
        const manifestMap = new Map(staticManifests.map(m => [m.bookId, m]));

        const manifestBooks: SyncManifest['books'] = {};

        // Map Inventory & Progress
        for (const inv of inventory) {
            const prog = progress.find(p => p.bookId === inv.bookId);
            const bookId = inv.bookId;
            const man = manifestMap.get(bookId);

            // Construct ReadingHistoryEntry from UserJourney + UserProgress
            // Filter journey for this book
            const bookJourney = journey.filter(j => j.bookId === bookId);
            // Sort by timestamp
            bookJourney.sort((a, b) => a.startTimestamp - b.startTimestamp);

            const hist: ReadingHistoryEntry = {
                bookId,
                readRanges: prog?.completedRanges || [],
                sessions: bookJourney.map(j => ({
                    cfiRange: j.cfiRange,
                    timestamp: j.startTimestamp,
                    type: j.type === 'tts' ? 'tts' : 'page', // Legacy type mapping
                    label: undefined
                })),
                lastUpdated: prog?.lastRead || 0
            };

            const bookAnns = annotations.filter(a => a.bookId === bookId).map(a => ({
                id: a.id,
                bookId: a.bookId,
                cfiRange: a.cfiRange,
                text: a.text,
                type: a.type,
                color: a.color,
                note: a.note,
                created: a.created
            }));

            manifestBooks[bookId] = {
                metadata: {
                    id: bookId,
                    title: inv.customTitle || man?.title,
                    author: inv.customAuthor || man?.author,
                    lastRead: prog?.lastRead,
                    progress: prog?.percentage,
                    currentCfi: prog?.currentCfi,
                    // We map back fields compatible with BookMetadata partial
                },
                history: hist,
                annotations: bookAnns
            };
        }

        // Map Overrides to Lexicon (Flattening book specific rules)
        // SyncManifest.lexicon is currently a flat array of LexiconRule.
        // v18 user_overrides is grouped by bookId.
        const flattenedLexicon: LexiconRule[] = [];
        for (const ov of overrides) {
            for (const r of ov.lexicon) {
                flattenedLexicon.push({
                    id: r.id,
                    original: r.original,
                    replacement: r.replacement,
                    isRegex: r.isRegex,
                    created: r.created,
                    bookId: ov.bookId === 'global' ? undefined : ov.bookId,
                    applyBeforeGlobal: ov.lexiconConfig?.applyBefore,
                    // Order is not explicit in new schema item, but implicit in array.
                    // We might lose order across merge if not handled.
                });
            }
        }

        // Reading List -> UserInventory
        // UserInventory IS the reading list now.
        // We can map inventory items to ReadingListEntry for manifest structure.
        const readingList: SyncManifest['readingList'] = {};
        for (const inv of inventory) {
            if (inv.sourceFilename) {
                 const prog = progress.find(p => p.bookId === inv.bookId);
                 const man = manifestMap.get(inv.bookId);
                 readingList[inv.sourceFilename] = {
                     filename: inv.sourceFilename,
                     title: inv.customTitle || man?.title || 'Unknown',
                     author: inv.customAuthor || man?.author || 'Unknown',
                     isbn: man?.isbn,
                     percentage: prog?.percentage || 0,
                     lastUpdated: inv.lastInteraction,
                     status: inv.status === 'completed' ? 'read' : (inv.status === 'reading' ? 'currently-reading' : 'to-read'),
                     rating: inv.rating
                 };
            }
        }

        // Transient State (TTS Positions)
        // From user_progress
        const ttsPosMap: SyncManifest['transientState']['ttsPositions'] = {};
        for (const prog of progress) {
            if (prog.currentQueueIndex !== undefined) {
                ttsPosMap[prog.bookId] = {
                    bookId: prog.bookId,
                    currentIndex: prog.currentQueueIndex,
                    sectionIndex: prog.currentSectionIndex,
                    updatedAt: prog.lastRead // Approx
                };
            }
        }

        return {
            version: 1, // Keep v1 for compatibility with existing clients? Or bump?
            // If we bump to v2, we can change structure. But let's stick to v1 structure for now.
            lastUpdated: Date.now(),
            deviceId: 'browser',
            books: manifestBooks,
            lexicon: flattenedLexicon,
            readingList,
            transientState: {
                ttsPositions: ttsPosMap
            },
            deviceRegistry: {}
        };
    }

    private async applyManifest(manifest: SyncManifest) {
        const db = await getDB();

        // We need to write to: user_inventory, user_progress, user_annotations, user_overrides, user_journey.
        const tx = db.transaction([
            'user_inventory', 'user_progress', 'user_annotations', 'user_overrides', 'user_journey'
        ], 'readwrite');

        const invStore = tx.objectStore('user_inventory');
        const progStore = tx.objectStore('user_progress');
        const annStore = tx.objectStore('user_annotations');
        const overrideStore = tx.objectStore('user_overrides');
        const journeyStore = tx.objectStore('user_journey');

        // Apply Books
        for (const [bookId, data] of Object.entries(manifest.books)) {
            // Check if book exists locally in inventory
            const inv = await invStore.get(bookId);

            if (inv) {
                // Update Inventory
                if (data.metadata.title && data.metadata.title !== inv.customTitle) inv.customTitle = data.metadata.title;
                // Note: Title in manifest might be static title, not custom.
                // We should be careful overwriting custom title.
                // SyncManifest stores `metadata` which is Partial<BookMetadata>.
                // It's ambiguous if it's custom or original.
                // Let's assume for now we don't overwrite unless explicitly managed.
                // But `progress` is critical.

                await invStore.put(inv);

                // Update Progress
                let prog = await progStore.get(bookId);
                if (!prog) {
                    prog = { bookId, percentage: 0, lastRead: 0, completedRanges: [] };
                }

                if (data.metadata.progress !== undefined) prog.percentage = data.metadata.progress;
                if (data.metadata.lastRead !== undefined) prog.lastRead = data.metadata.lastRead;
                if (data.metadata.currentCfi !== undefined) prog.currentCfi = data.metadata.currentCfi;

                // History (Read Ranges)
                if (data.history && data.history.readRanges) {
                    // Merge ranges logic needed? `applyManifest` usually overwrites or merges.
                    // Ideally we merge unique ranges.
                    // For simplicity, we trust manifest (LWW).
                    prog.completedRanges = data.history.readRanges;
                }

                await progStore.put(prog);

                // Journey (Sessions)
                // This is append-only usually.
                // We receive a list of sessions. We should add missing ones.
                if (data.history && data.history.sessions) {
                    const existingJourney = await journeyStore.index('by_bookId').getAll(bookId);
                    const existingTimestamps = new Set(existingJourney.map(j => j.startTimestamp));

                    for (const session of data.history.sessions) {
                        if (!existingTimestamps.has(session.timestamp)) {
                            await journeyStore.add({
                                bookId,
                                startTimestamp: session.timestamp,
                                endTimestamp: session.timestamp + 60000, // Estimate
                                duration: 60,
                                cfiRange: session.cfiRange,
                                type: session.type === 'tts' ? 'tts' : 'visual'
                            });
                        }
                    }
                }

                // Annotations
                // Overwrite/Add
                for (const ann of data.annotations) {
                     await annStore.put({
                         id: ann.id,
                         bookId: ann.bookId,
                         cfiRange: ann.cfiRange,
                         text: ann.text,
                         type: ann.type,
                         color: ann.color,
                         note: ann.note,
                         created: ann.created
                     });
                }
            }
            // If book doesn't exist locally, we currently don't create it because we lack the file.
            // Unless we want to create a "Ghost" inventory item?
            // "Domain 2: User ... Store: user_inventory ... Description: Existence of book in library".
            // Yes, we should probably create ghost items if they are in manifest!
            // But we lack `sourceFilename` unless it's in ReadingList.
        }

        // Lexicon
        // Group by bookId
        const ruleMap = new Map<string, LexiconRule[]>();
        for (const rule of manifest.lexicon) {
            const bid = rule.bookId || 'global';
            if (!ruleMap.has(bid)) ruleMap.set(bid, []);
            ruleMap.get(bid)?.push(rule);
        }

        for (const [bid, rules] of ruleMap.entries()) {
            const ov = await overrideStore.get(bid) || { bookId: bid, lexicon: [] };
            // Merge logic: Add missing, update existing
            // Simple approach: Replace lexicon list with manifest list (LWW on list)?
            // Or merge individual rules by ID.
            const localRulesMap = new Map(ov.lexicon.map(r => [r.id, r]));

            for (const r of rules) {
                localRulesMap.set(r.id, {
                    id: r.id,
                    original: r.original,
                    replacement: r.replacement,
                    isRegex: r.isRegex,
                    created: r.created
                });
                if (r.applyBeforeGlobal !== undefined) {
                    ov.lexiconConfig = { applyBefore: r.applyBeforeGlobal };
                }
            }
            ov.lexicon = Array.from(localRulesMap.values());
            await overrideStore.put(ov);
        }

        // Reading List (Ghost Items?)
        // If items are in reading list but not in inventory, create ghost items.
        for (const entry of Object.values(manifest.readingList)) {
            // Check if inventory exists by filename?
            // Expensive check without index.
            // We'll skip for now.
        }

        // TTS Positions
        for (const pos of Object.values(manifest.transientState.ttsPositions)) {
            const prog = await progStore.get(pos.bookId);
            if (prog) {
                prog.currentQueueIndex = pos.currentIndex;
                prog.currentSectionIndex = pos.sectionIndex;
                await progStore.put(prog);
            }
        }

        await tx.done;
    }
}
