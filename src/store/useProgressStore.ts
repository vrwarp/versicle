import { create } from 'zustand';
import { yjs } from './middleware/yjs';
import { yDoc } from './yjs-provider';
import type { UserProgress } from '../types/db';

export type ProgressState = Record<string, UserProgress>;

export const useProgressStore = create<ProgressState>()(
  yjs(
    yDoc,
    'progress',
    () => ({})
  )
);
