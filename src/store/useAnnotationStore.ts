import { create } from 'zustand';
import { defineSyncedStore, type SyncedStoreDef } from './yjs-provider';
import type { UserAnnotation } from '~types/user-data';
import { createLogger } from '@lib/logger';
import { generateSecureId } from '@lib/crypto';

const logger = createLogger('AnnotationStore');

/**
 * Annotation store state.
 *
 * Phase 2 (Yjs Migration): This store is wrapped with yjs() middleware.
 * - `annotations` (Record): Synced to yDoc.getMap('annotations')
 * - Actions (functions): Not synced, local-only
 *
 * NOTE (popover-desync hotfix): the ephemeral annotation popover state used to
 * live here, which synced screen coordinates through the CRDT to other devices.
 * It now lives in useReaderUIStore (ephemeral, non-synced). Older documents may
 * still contain a stale `popover` key in the `annotations` Y.Map; it is no
 * longer read or written, and is scheduled for deletion in the v6 CRDT
 * migration (Phase 2 of the overhaul plan). Do not reuse the `popover` key name
 * in this store before that migration lands.
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
   * Loads annotations for a specific book (legacy compatibility).
   * With Yjs, this is a no-op since all annotations are always loaded.
   * @param bookId - The book ID (unused, for backwards compatibility).
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
 * `popover` doc key (see module docs) is structurally outside `syncedKeys`,
 * so it can never ride into store state again.
 * Flipped to merge-defaults + scopedDiff in flip wave 4 (phase2-fork-surgery.md
 * §2.6 #7): real user data but a single simple key; no top-level canaries
 * existed (the actions already assumed `annotations` present).
 */
export const ANNOTATIONS_STORE_DEF: SyncedStoreDef<'annotations'> = {
  name: 'annotations',
  syncedKeys: ['annotations'],
  hydration: 'merge-defaults',
  scopedDiff: true,
};

/**
 * Factory to create the Annotation store with dependency injection.
 * In Phase 2, this no longer needs dbProvider since Yjs handles persistence.
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
        // Kept for backwards compatibility with components
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
 * Returns all pending audio bookmarks across all books (moved from the
 * deleted selectors.ts façade — it is a pure selector over THIS store).
 */
export const selectPendingAudioBookmarks = (state: AnnotationState): UserAnnotation[] => {
    return Object.values(state.annotations).filter(a => a.type === 'audio-bookmark');
};
