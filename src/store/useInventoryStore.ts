import { create } from 'zustand';
import { yjs } from './middleware/yjs';
import { yDoc } from './yjs-provider';
import type { UserInventoryItem } from '../types/db';

// The Inventory Store is purely a data store for the Yjs Map.
// It maps BookID -> UserInventoryItem.
// It does NOT contain UI state or actions.
export type InventoryState = Record<string, UserInventoryItem>;

export const useInventoryStore = create<InventoryState>()(
  yjs(
    yDoc,
    'inventory',
    () => ({}) // Initial state is empty, hydrated from Yjs
  )
);
