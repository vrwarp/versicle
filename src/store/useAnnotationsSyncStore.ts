import { create } from 'zustand';
import { yjs } from './middleware/yjs';
import { yDoc } from './yjs-provider';
import type { UserAnnotation } from '../types/db';

export type AnnotationsState = Record<string, UserAnnotation>;

export const useAnnotationsSyncStore = create<AnnotationsState>()(
  yjs(
    yDoc,
    'annotations',
    () => ({})
  )
);
