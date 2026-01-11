import { create } from 'zustand';

/**
 * DEPRECATED: useReaderStore has been split into useReaderUIStore and useReaderSyncStore.
 * This file is kept as a placeholder to prevent immediate build breakages during migration,
 * but all consumers should migrate to the new stores.
 */

// Re-export new stores for convenience during refactoring (optional, but better to force direct import)
import { useReaderUIStore } from './useReaderUIStore';
import { useReaderSyncStore } from './useReaderSyncStore';

// Facade to provide backward compatibility (Partial)
// Note: Proxies don't work well with Zustand selectors if the state shape changes.
// We strongly recommend migrating consumers.

// We export a dummy store that warns on usage.
export const useReaderStore = create((set) => ({
    // Warn on access
    ...useReaderUIStore.getState(),
    ...useReaderSyncStore.getState(),
}));

// Monkey-patch console.warn to notify dev (optional)
console.warn("useReaderStore is deprecated. Please use useReaderUIStore or useReaderSyncStore.");
