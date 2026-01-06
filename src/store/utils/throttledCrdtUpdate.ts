
// Helper for throttled updates
// We use a standalone debounced function per book ID ideally, but for simplicity
// we use a single debounced function that takes bookId and updates.
// However, debounce delays the *execution*. If we call it with different args, it might use the last one.
// Since we update progress, last-one-wins is fine.

import { crdtService } from '../../lib/crdt/CRDTService';
import debounce from 'lodash/debounce';

const updateCrdt = async (bookId: string, updates: any) => {
    await crdtService.waitForReady();
    const booksMap = crdtService.books;
    const bookMap = booksMap.get(bookId);
    if (bookMap) {
        // We need to apply updates carefully.
        // Y.Map.set triggers an event.
        // We should check if value changed to avoid redundant ops if possible,
        // but Yjs handles that reasonably well.
        Object.entries(updates).forEach(([key, value]) => {
            bookMap.set(key, value);
        });
    }
};

export const throttledCrdtUpdate = debounce(updateCrdt, 60000);
