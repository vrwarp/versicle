import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { dbService } from '../db/DBService';
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
   * Loads annotations for a specific book from the database.
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

  /**
   * INTERNAL: Updates the store from an external source (CRDT/Sync).
   * @param annotations - The new list of annotations.
   */
  internalSync: (annotations: Annotation[]) => void;

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

  loadAnnotations: async (bookId: string) => {
    try {
      const annotations = await dbService.getAnnotations(bookId);
      set({ annotations });
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
      await dbService.addAnnotation(newAnnotation);
      set((state) => ({
        annotations: [...state.annotations, newAnnotation],
      }));
    } catch (error) {
      console.error('Failed to add annotation:', error);
    }
  },

  deleteAnnotation: async (id: string) => {
    try {
      await dbService.deleteAnnotation(id);
      set((state) => ({
        annotations: state.annotations.filter((a) => a.id !== id),
      }));
    } catch (error) {
      console.error('Failed to delete annotation:', error);
    }
  },

  updateAnnotation: async (id: string, changes: Partial<Annotation>) => {
    try {
      await dbService.updateAnnotation(id, changes);
      set((state) => ({
        annotations: state.annotations.map((a) => (a.id === id ? { ...a, ...changes } : a)),
      }));
    } catch (error) {
      console.error('Failed to update annotation:', error);
    }
  },

  internalSync: (annotations: Annotation[]) => {
    set({ annotations });
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
