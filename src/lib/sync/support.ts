
/**
 * Checks if the browser environment supports IndexedDB.
 * This is crucial before initializing Y-IndexedDB to prevent runtime crashes
 * in environments like server-side rendering or restricted iframes.
 */
export const isStorageSupported = (): boolean => {
    try {
        return typeof window !== 'undefined' && 'indexedDB' in window && window.indexedDB !== null;
    } catch (e) {
        console.warn('IndexedDB check failed:', e);
        return false;
    }
};
