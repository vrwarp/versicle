import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../db/db';
import type { Annotation } from '../types/db';

interface PopoverState {
  visible: boolean;
  x: number;
  y: number;
  cfiRange: string;
  text: string;
}

interface AnnotationState {
  annotations: Annotation[];
  popover: PopoverState;

  // Actions
  loadAnnotations: (bookId: string) => Promise<void>;
  addAnnotation: (annotation: Omit<Annotation, 'id' | 'created'>) => Promise<void>;
  deleteAnnotation: (id: string) => Promise<void>;
  updateAnnotation: (id: string, changes: Partial<Annotation>) => Promise<void>;

  // Popover Actions
  showPopover: (x: number, y: number, cfiRange: string, text: string) => void;
  hidePopover: () => void;
}

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
      const db = await getDB();
      const annotations = await db.getAllFromIndex('annotations', 'by_bookId', bookId);
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
      const db = await getDB();
      await db.add('annotations', newAnnotation);
      set((state) => ({
        annotations: [...state.annotations, newAnnotation],
      }));
    } catch (error) {
      console.error('Failed to add annotation:', error);
    }
  },

  deleteAnnotation: async (id: string) => {
    try {
      const db = await getDB();
      await db.delete('annotations', id);
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
        await db.put('annotations', updated);
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
