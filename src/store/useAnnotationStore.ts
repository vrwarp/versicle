import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { UserAnnotation } from '../types/db';
import { useAnnotationsSyncStore } from './useAnnotationsSyncStore';

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

  // Actions
  addAnnotation: (annotation: Omit<UserAnnotation, 'id' | 'created'>) => void;
  deleteAnnotation: (id: string) => void;
  updateAnnotation: (id: string, changes: Partial<UserAnnotation>) => void;

  showPopover: (x: number, y: number, cfiRange: string, text: string) => void;
  hidePopover: () => void;
}

export const useAnnotationStore = create<AnnotationState>((set) => ({
  annotations: {}, // Initial state
  popover: {
    visible: false,
    x: 0,
    y: 0,
    cfiRange: '',
    text: '',
  },

  addAnnotation: (partialAnnotation) => {
    const id = uuidv4();
    const newAnnotation: UserAnnotation = {
      ...partialAnnotation,
      id,
      created: Date.now(),
    };
    useAnnotationsSyncStore.setState({ [id]: newAnnotation });
  },

  deleteAnnotation: (id) => {
    useAnnotationsSyncStore.setState({ [id]: undefined as unknown as UserAnnotation });
  },

  updateAnnotation: (id, changes) => {
    const current = useAnnotationsSyncStore.getState()[id];
    if (current) {
        useAnnotationsSyncStore.setState({ [id]: { ...current, ...changes } });
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
        popover: { ...state.popover, visible: false }
    }));
  },
}));

// Wiring: Sync AnnotationsSyncStore -> AnnotationStore
useAnnotationsSyncStore.subscribe((annotations) => {
    useAnnotationStore.setState({ annotations });
});
