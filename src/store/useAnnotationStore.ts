import { create } from 'zustand';
import { yjsMiddleware } from './middleware/yjs';
import { v4 as uuidv4 } from 'uuid';
import { yDoc } from './yjs-provider';
import type { UserAnnotation } from '../types/db';
import { getDB } from '../db/db';

interface PopoverState {
  visible: boolean;
  x: number;
  y: number;
  cfiRange: string;
  text: string;
}

interface AnnotationState {
  annotations: Record<string, UserAnnotation>;
  popover: PopoverState;

  loadAnnotations: (bookId: string) => Promise<void>; // Deprecated/Legacy support
  addAnnotation: (annotation: Omit<UserAnnotation, 'id' | 'created'>) => Promise<void>;
  deleteAnnotation: (id: string) => Promise<void>;
  updateAnnotation: (id: string, changes: Partial<UserAnnotation>) => Promise<void>;

  showPopover: (x: number, y: number, cfiRange: string, text: string) => void;
  hidePopover: () => void;
}

export const useAnnotationStore = create<AnnotationState>()(
  yjsMiddleware(yDoc, 'annotations', (set, get) => ({
    annotations: {},
    popover: {
      visible: false,
      x: 0,
      y: 0,
      cfiRange: '',
      text: '',
    },

    loadAnnotations: async (bookId: string) => {
      // Legacy: This might be needed if we want to migrate on the fly or if we keep using DBService for something.
      // But with Yjs, we should just rely on the store.
      // We'll keep it as a no-op or migration trigger if needed.
    },

    addAnnotation: async (partialAnnotation) => {
      const newAnnotation: UserAnnotation = {
        ...partialAnnotation,
        id: uuidv4(),
        created: Date.now(),
      };

      set((state) => {
          state.annotations[newAnnotation.id] = newAnnotation;
      });
    },

    deleteAnnotation: async (id: string) => {
      set((state) => {
          delete state.annotations[id];
      });
    },

    updateAnnotation: async (id: string, changes: Partial<UserAnnotation>) => {
       set((state) => {
           if (state.annotations[id]) {
               state.annotations[id] = { ...state.annotations[id], ...changes };
           }
       });
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
  }))
);
