import { create } from 'zustand';
import { defineSyncedStore, type SyncedStoreDef } from './yjs-provider';
import type { UserAnnotation } from '~types/user-data';
import { createLogger } from '@lib/logger';
import { generateSecureId } from '@lib/crypto';

const logger = createLogger('AnnotationStore');

/**
 * Annotation store state.
 *
 * This store is wrapped with the yjs() middleware (via defineSyncedStore).
 * - `annotations` (Record): Synced to yDoc.getMap('annotations')
 * - Actions (functions): Not synced, local-only
 *
 * NOTE: the ephemeral annotation popover state lives in useReaderUIStore
 * (ephemeral, non-synced), never here — syncing it would replicate screen
 * coordinates through the CRDT to other devices. Documents written by older
 * builds may carry a stale `popover` key in the `annotations` Y.Map; this store
 * never reads or writes it, and the v6 CRDT migration (src/app/migrations.ts)
 * deletes it.
 */
export interface AnnotationState {
  // === SYNCED STATE (persisted to Yjs) ===
  /** Map of annotations keyed by UUID. */
  annotations: Record<string, UserAnnotation>;

  // === ACTIONS (not synced to Yjs) ===
  /**
   * Adds a new annotation.
   * @param annotation - Annotation data without id and created timestamp.
   * @returns The generated UUID for the annotation.
   */
  add: (annotation: Omit<UserAnnotation, 'id' | 'created'> & { created?: number }) => string;
  /**
   * Updates an existing annotation.
   * @param id - The annotation ID.
   * @param updates - Partial updates to apply.
   */
  update: (id: string, updates: Partial<UserAnnotation>) => void;
  /**
   * Removes an annotation.
   * @param id - The annotation ID to remove.
   */
  remove: (id: string) => void;
  /**
   * Loads annotations for a specific book.
   * With Yjs, this is a no-op since all annotations are always loaded.
   * @param bookId - The book ID (unused).
   */
  loadAnnotations: (bookId: string) => Promise<void>;
  /**
   * Gets all annotations for a specific book.
   * @param bookId - The book ID.
   * @returns Array of annotations for the book.
   */
  getByBook: (bookId: string) => UserAnnotation[];
}

/**
 * Replication declaration (aggregated by src/store/registry.ts). The stale
 * `popover` doc key (see the note on {@link AnnotationState}) is structurally
 * outside `syncedKeys`, so it can never ride into store state.
 * merge-defaults + scopedDiff: real user data but a single simple key; no
 * top-level canaries (the actions assume `annotations` present).
 */
export const ANNOTATIONS_STORE_DEF: SyncedStoreDef<'annotations'> = {
  name: 'annotations',
  syncedKeys: ['annotations'],
  hydration: 'merge-defaults',
  scopedDiff: true,
};

/**
 * Factory to create the Annotation store. Persistence is handled by the Yjs
 * middleware, so no database provider is injected.
 */
export const createAnnotationStore = () => create<AnnotationState>()(
  defineSyncedStore(
    ANNOTATIONS_STORE_DEF,
    (set, get) => ({
      // Synced state
      annotations: {},

      // Actions
      add: (partialAnnotation) => {
        const id = generateSecureId();
        const { created, ...rest } = partialAnnotation;
        const newAnnotation: UserAnnotation = {
          ...rest,
          id,
          created: created ?? Date.now(),
        };

        // Update state (middleware syncs to Yjs)
        set((state) => ({
          annotations: {
            ...state.annotations,
            [id]: newAnnotation
          }
        }));

        return id;
      },

      update: (id, updates) => {
        set((state) => {
          if (!state.annotations[id]) {
            logger.warn(`Annotation ${id} not found`);
            return state;
          }

          return {
            annotations: {
              ...state.annotations,
              [id]: {
                ...state.annotations[id],
                ...updates
              }
            }
          };
        });
      },

      remove: (id) => {
        set((state) => {
          const { [id]: _removed, ...remaining } = state.annotations;
          return { annotations: remaining };
        });
      },

      loadAnnotations: async (bookId: string) => {
        // No-op: With Yjs, annotations are always loaded
        // Kept because components still call it
        logger.debug(`loadAnnotations called for book ${bookId} (no-op with Yjs)`);
      },

      getByBook: (bookId) => {
        const { annotations } = get();
        const bookAnnotations: UserAnnotation[] = [];
        for (const key in annotations) {
          if (!Object.prototype.hasOwnProperty.call(annotations, key)) continue;
          if (annotations[key].bookId === bookId) {
            bookAnnotations.push(annotations[key]);
          }
        }
        return bookAnnotations.sort((a, b) => a.created - b.created);
      },
    })
  )
);

/**
 * Zustand store for managing annotations (highlights and notes).
 * Wrapped with yjs() middleware for automatic CRDT synchronization.
 */
export const useAnnotationStore = createAnnotationStore();

/**
 * Returns all pending audio bookmarks across all books. A pure selector over
 * THIS store.
 */
export const selectPendingAudioBookmarks = (state: AnnotationState): UserAnnotation[] => {
    return Object.values(state.annotations).filter(a => a.type === 'audio-bookmark');
};
