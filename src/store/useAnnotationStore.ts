import { create } from 'zustand';
import { yjs } from 'zustand-middleware-yjs';
import { v4 as uuidv4 } from 'uuid';
import { yDoc } from './yjs-provider';
import type { Annotation, UserAnnotation } from '../types/db';

interface AnnotationState {
  /**
   * Map of annotations keyed by their UUID.
   * Bound to Yjs map 'annotations' -> 'annotations'.
   */
  annotations: Record<string, UserAnnotation>;

  addAnnotation: (annotation: Omit<UserAnnotation, 'id' | 'created'>) => void;
  deleteAnnotation: (id: string) => void;

  // Note: updateAnnotation logic is handled by modifying the object in the map directly
  // via set function in Zustand-Yjs, which proxies changes.
  updateAnnotation: (id: string, changes: Partial<UserAnnotation>) => void;
}

/**
 * Zustand store for managing user annotations (highlights, notes).
 * Synced via Yjs.
 */
export const useAnnotationStore = create<AnnotationState>()(
  yjs(
    yDoc,
    'annotations',
    (set) => ({
      annotations: {},

      addAnnotation: (partialAnnotation) =>
        set((state) => {
          const id = uuidv4();
          const newAnnotation: UserAnnotation = {
            ...partialAnnotation,
            id,
            created: Date.now(),
          };
          state.annotations[id] = newAnnotation;
        }),

      deleteAnnotation: (id) =>
        set((state) => {
          delete state.annotations[id];
        }),

      updateAnnotation: (id, changes) =>
        set((state) => {
          if (state.annotations[id]) {
            Object.assign(state.annotations[id], changes);
          }
        }),
    })
  )
);
