import { crdtService } from './CRDTService';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { useSyncStore } from '../sync/hooks/useSyncStore';
import equal from 'fast-deep-equal';
import type * as Y from 'yjs';
import type { BookMetadata } from '../../types/db';
import { validateBookMetadata } from '../../db/validators';

/**
 * Service to observe Yjs events and update Zustand stores.
 * This bridges the "Moral Layer" (CRDT) to the "View Layer" (React/Zustand).
 */
export class YjsObserverService {
    private static instance: YjsObserverService;
    private initialized = false;

    private constructor() {}

    static getInstance(): YjsObserverService {
        if (!YjsObserverService.instance) {
            YjsObserverService.instance = new YjsObserverService();
        }
        return YjsObserverService.instance;
    }

    /**
     * Initialize observers on the shared Yjs document.
     */
    async initialize() {
        if (this.initialized) return;

        // Wait for IDB to load
        await crdtService.waitForReady();

        this.observeBooks();
        this.observeAnnotations();
        this.observeSettings();

        // Initial sync of data to stores
        this.syncBooksToStore();
        this.syncAnnotationsToStore();
        this.syncSettingsToStore();

        this.initialized = true;
        console.log('[YjsObserver] Initialized');
    }

    private observeBooks() {
        // Observe the top-level 'books' map
        crdtService.books.observeDeep(() => {
            // Check origin to avoid loops if we ever write back from Zustand (which we shouldn't directly)
            // But currently DBService writes to Yjs, and Yjs updates trigger this.
            // If DBService update was triggered by UI, we still want to update UI state if it was a partial update?
            // Actually, DBService writes are the source of truth.
            // If I call setProgress in UI -> DBService -> Yjs -> Observer -> setBooks in UI.
            // This is a loop if setBooks triggers DBService, but setBooks in Zustand just sets memory state.
            // So it's safe.

            // We only care about the result, so we re-read the map.
            // For performance, we could parse events, but for < 1000 books, full diff is okay or just re-emit all.
            // useLibraryStore handles the diffing via React, but we can prevent unnecessary set calls.

            // However, verify origin.
            // If the transaction origin is 'yjs-observer', we ignore (unlikely).

            this.syncBooksToStore();
        });
    }

    private observeAnnotations() {
        crdtService.annotations.observeDeep(() => {
            this.syncAnnotationsToStore();
        });
    }

    private observeSettings() {
        crdtService.settings.observeDeep(() => {
            this.syncSettingsToStore();
        });
    }

    private syncBooksToStore() {
        const booksMap = crdtService.books;
        const validBooks: BookMetadata[] = [];

        booksMap.forEach((bookMap: Y.Map<any>) => {
             const book = bookMap.toJSON() as BookMetadata;
             if (validateBookMetadata(book)) {
                 validBooks.push(book);
             }
        });

        // Sort by addedAt descending (default)
        validBooks.sort((a, b) => b.addedAt - a.addedAt);

        const currentBooks = useLibraryStore.getState().books;

        // Deep equality check to prevent re-renders
        if (!equal(currentBooks, validBooks)) {
            useLibraryStore.getState().internalSync(validBooks);
        }
    }

    private syncAnnotationsToStore() {
        // We need to support filtering by bookId, but the store holds "all loaded annotations" or "current book annotations"?
        // useAnnotationStore has 'annotations' array. It has loadAnnotations(bookId).
        // It seems it only holds annotations for the *current* book or whatever was last loaded.
        // If we observe *global* annotations, we need to know which book is active to filter.
        // Or, we just update the store if the changed annotation belongs to the currently loaded book(s).

        // HACK: We can't easily know strictly which book is "active" without coupling to ReaderStore.
        // But useAnnotationStore usually holds annotations for one book.
        // Let's check if we can inspect the store state.

        const currentAnnotations = useAnnotationStore.getState().annotations;
        if (currentAnnotations.length === 0) return; // No book loaded?

        // Heuristic: Filter CRDT annotations by the bookId of the first annotation in the store.
        // If the store is empty, we don't know what to load, so we do nothing until `loadAnnotations` is called manually.
        const activeBookId = currentAnnotations[0]?.bookId;

        if (activeBookId) {
            const allCrdtAnnotations = crdtService.annotations.toArray();
            const filtered = allCrdtAnnotations.filter(a => a.bookId === activeBookId);

            if (!equal(currentAnnotations, filtered)) {
                useAnnotationStore.getState().internalSync(filtered);
            }
        }
    }

    private syncSettingsToStore() {
        const settings = crdtService.settings.toJSON();
        const current = useSyncStore.getState();

        // Mapping CRDT settings to SyncStore
        // Assuming 'sync-storage' keys: googleClientId, googleApiKey, isSyncEnabled
        // We only update if they exist in CRDT (migrated).

        let hasChanges = false;
        if (settings.googleClientId && settings.googleClientId !== current.googleClientId) hasChanges = true;
        if (settings.googleApiKey && settings.googleApiKey !== current.googleApiKey) hasChanges = true;
        if (typeof settings.isSyncEnabled === 'boolean' && settings.isSyncEnabled !== current.isSyncEnabled) hasChanges = true;

        if (hasChanges) {
            // We use the setters from the store to ensure reactivity
            // But since we have multiple fields, we might need a batch update or just call setters.
            // useSyncStore doesn't have a batch set.
            // We can add internalSync there too or just call setGoogleCredentials.

            if (settings.googleClientId || settings.googleApiKey) {
                useSyncStore.getState().setGoogleCredentials(
                    settings.googleClientId || current.googleClientId,
                    settings.googleApiKey || current.googleApiKey
                );
            }
            if (typeof settings.isSyncEnabled === 'boolean') {
                useSyncStore.getState().setSyncEnabled(settings.isSyncEnabled);
            }
        }
    }
}
