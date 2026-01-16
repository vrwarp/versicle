import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';
import type { UserAnnotation } from '../types/db';

/**
 * UI state for the annotation popover (not synced to Yjs).
 */
interface PopoverState {
  visible: boolean;
  x: number;
  y: number;
  cfiRange: string;
  text: string;
}

/**
 * Annotation store state.
 * 
 * Phase 2 (Yjs Migration): This store is wrapped with yjs() middleware.
 * - `annotations` (Record): Synced to yDoc.getMap('annotations')
 * - `popover`: Transient UI state (not synced)
 * - Actions (functions): Not synced, local-only
 */
interface AnnotationState {
  // === SYNCED STATE (persisted to Yjs) ===
  /** Map of annotations keyed by UUID. */
  annotations: Record<string, UserAnnotation>;

  // === TRANSIENT STATE (local-only, not synced) ===
  /** Popover state for creating new annotations. */
  popover: PopoverState;

  // === ACTIONS (not synced to Yjs) ===
  /**
   * Adds a new annotation.
   * @param annotation - Annotation data without id and created timestamp.
   * @returns The generated UUID for the annotation.
   */
  add: (annotation: Omit<UserAnnotation, 'id' | 'created'>) => string;
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
  /**
   * Shows the annotation popover.
   */
  showPopover: (x: number, y: number, cfiRange: string, text: string) => void;
  /**
   * Hides the annotation popover.
   */
  hidePopover: () => void;
}

/**
 * Factory to create the Annotation store with dependency injection.
 * In Phase 2, this no longer needs dbProvider since Yjs handles persistence.
 */
export const createAnnotationStore = () => create<AnnotationState>()(
  yjs(
    yDoc,
    'annotations',
    (set, get) => ({
      // Synced state
      annotations: {},

      // Transient state
      popover: {
        visible: false,
        x: 0,
        y: 0,
        cfiRange: '',
        text: '',
      },

      // Actions
      add: (partialAnnotation) => {
        const id = crypto.randomUUID();
        const newAnnotation: UserAnnotation = {
          ...partialAnnotation,
          id,
          created: Date.now(),
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
            console.warn(`Annotation ${id} not found`);
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
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [id]: _removed, ...remaining } = state.annotations;
          return { annotations: remaining };
        });
      },

      loadAnnotations: async (bookId: string) => {
        // No-op: With Yjs, annotations are always loaded
        // Kept for backwards compatibility with components
        console.debug(`loadAnnotations called for book ${bookId} (no-op with Yjs)`);
      },

      getByBook: (bookId) => {
        const { annotations } = get();
        return Object.values(annotations)
          .filter(ann => ann.bookId === bookId)
          .sort((a, b) => a.created - b.created);
      },

      showPopover: (x, y, cfiRange, text) => {
        set({
          popover: {
            visible: true,
            x,
            y,
            cfiRange,
            text,
          },
        });
      },

      hidePopover: () => {
        set((state) => ({
          popover: {
            ...state.popover,
            visible: false,
          },
        }));
      },
    })
  )
);

/**
 * Zustand store for managing annotations (highlights and notes).
 * Wrapped with yjs() middleware for automatic CRDT synchronization.
 */
export const useAnnotationStore = createAnnotationStore();
