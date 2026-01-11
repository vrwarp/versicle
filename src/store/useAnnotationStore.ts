import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { v4 as uuidv4 } from 'uuid';
import { yDoc } from './yjs-provider';
import type { UserAnnotation } from '../types/db';

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

      addAnnotation: (partialAnnotation: Omit<UserAnnotation, 'id' | 'created'>) =>
        set((state: AnnotationState) => {
          const id = uuidv4();
          const newAnnotation: UserAnnotation = {
            ...partialAnnotation,
            id,
            created: Date.now(),
          };
          return {
            annotations: {
              ...state.annotations,
              [id]: newAnnotation,
            },
          };
        }),

      deleteAnnotation: (id: string) =>
        set((state: AnnotationState) => {
          const newAnnotations = { ...state.annotations };
          delete newAnnotations[id];
          return { annotations: newAnnotations };
        }),

      updateAnnotation: (id: string, changes: Partial<UserAnnotation>) =>
        set((state: AnnotationState) => {
          if (!state.annotations[id]) return {};
          return {
            annotations: {
              ...state.annotations,
              [id]: {
                ...state.annotations[id],
                ...changes,
              },
            },
          };
        }),
    })
  )
);

