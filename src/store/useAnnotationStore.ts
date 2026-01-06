import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../db/db';
import { crdtService } from '../lib/crdt/CRDTService';
import type { Annotation } from '../types/db';

/**
 * State of the annotation popover (selection menu).
 */
interface PopoverState {
  /** Whether the popover is visible. */
  visible: boolean;
  /** X-coordinate (viewport). */
  x: number;
  /** Y-coordinate (viewport). */
  y: number;
  /** The selected CFI range. */
  cfiRange: string;
  /** The selected text. */
  text: string;
}

/**
 * State interface for the Annotation store.
 */
interface AnnotationState {
  /** List of loaded annotations for the current book. */
  annotations: Annotation[];
  /** State of the annotation popover. */
  popover: PopoverState;

  // Actions
  /**
   * Initializes the store (subscribes to CRDT).
   */
  init: () => Promise<void>;
  /**
   * Loads annotations for a specific book.
   * Now primarily filters the local CRDT state.
   * @param bookId - The unique identifier of the book.
   */
  loadAnnotations: (bookId: string) => Promise<void>;
  /**
   * Adds a new annotation to the database and store.
   * @param annotation - The annotation data (excluding ID and timestamp).
   */
  addAnnotation: (annotation: Omit<Annotation, 'id' | 'created'>) => Promise<void>;
  /**
   * Deletes an annotation by its ID.
   * @param id - The ID of the annotation to delete.
   */
  deleteAnnotation: (id: string) => Promise<void>;
  /**
   * Updates an existing annotation.
   * @param id - The ID of the annotation to update.
   * @param changes - The fields to update.
   */
  updateAnnotation: (id: string, changes: Partial<Annotation>) => Promise<void>;

  // Popover Actions
  /**
   * Shows the annotation popover at a specific location.
   * @param x - X-coordinate.
   * @param y - Y-coordinate.
   * @param cfiRange - The CFI range of the selection.
   * @param text - The selected text.
   */
  showPopover: (x: number, y: number, cfiRange: string, text: string) => void;
  /** Hides the annotation popover. */
  hidePopover: () => void;
}

/**
 * Zustand store for managing annotations and the annotation popup menu.
 */
export const useAnnotationStore = create<AnnotationState>((set) => ({
  annotations: [],
  popover: {
    visible: false,
    x: 0,
    y: 0,
    cfiRange: '',
    text: '',
  },

  init: async () => {
      // Phase 2 Implementation Note:
      // We purposefully rely on `loadAnnotations` for population and manual updates for mutations
      // to avoid filtering complexity without access to `currentBookId`.
      // Real-time observation will be implemented in Phase 3 when ReaderStore integration is tighter.
      await crdtService.waitForReady();
  },

  loadAnnotations: async (bookId: string) => {
    try {
      await crdtService.waitForReady();
      // Filter from Yjs
      const allAnnotations = crdtService.annotations.toArray();
      const bookAnnotations = allAnnotations.filter(a => a.bookId === bookId);
      set({ annotations: bookAnnotations });
    } catch (error) {
      console.error('Failed to load annotations:', error);
    }
  },

  addAnnotation: async (partialAnnotation) => {
    const newAnnotation: Annotation = {
      ...partialAnnotation,
      id: uuidv4(),
      created: Date.now(),
    };

    try {
      // 1. Update Legacy DB (Backup)
      const db = await getDB();
      await db.add('annotations', newAnnotation);

      // 2. Update Yjs (Moral Layer)
      crdtService.annotations.push([newAnnotation]);

      // 3. Update Local State
      set((state) => ({
        annotations: [...state.annotations, newAnnotation],
      }));
    } catch (error) {
      console.error('Failed to add annotation:', error);
    }
  },

  deleteAnnotation: async (id: string) => {
    try {
      // 1. Update Legacy DB
      const db = await getDB();
      await db.delete('annotations', id);

      // 2. Update Yjs
      // Y.Array doesn't support deleteById easily. We need to find index.
      const yArr = crdtService.annotations;
      let index = -1;
      for (let i = 0; i < yArr.length; i++) {
          if (yArr.get(i).id === id) {
              index = i;
              break;
          }
      }
      if (index !== -1) {
          yArr.delete(index, 1);
      }

      set((state) => ({
        annotations: state.annotations.filter((a) => a.id !== id),
      }));
    } catch (error) {
      console.error('Failed to delete annotation:', error);
    }
  },

  updateAnnotation: async (id: string, changes: Partial<Annotation>) => {
    try {
      const db = await getDB();
      const annotation = await db.get('annotations', id);

      if (annotation) {
        const updated = { ...annotation, ...changes };

        // 1. Update Legacy DB
        await db.put('annotations', updated);

        // 2. Update Yjs
        const yArr = crdtService.annotations;
        let index = -1;
        for (let i = 0; i < yArr.length; i++) {
            if (yArr.get(i).id === id) {
                index = i;
                break;
            }
        }
        if (index !== -1) {
             // Yjs Array doesn't support partial update of object.
             // We must delete and insert (or use Y.Map inside Y.Array if schema allowed, but it's JSON object).
             // Since it's a JSON object, we treat it as immutable replacement.
             yArr.delete(index, 1);
             yArr.insert(index, [updated]);
        }

        set((state) => ({
          annotations: state.annotations.map((a) => (a.id === id ? updated : a)),
        }));
      }
    } catch (error) {
      console.error('Failed to update annotation:', error);
    }
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
}));
