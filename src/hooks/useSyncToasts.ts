import { useEffect, useRef } from 'react';
import { useReadingStateStore } from '@store/useReadingStateStore';
import { getDeviceId } from '@lib/device-id';
import { useToastStore } from '@store/useToastStore';
import { useBookStore } from '@store/useBookStore';

/**
 * Hook to show toast notifications when reading progress arrives from OTHER
 * devices (mounted once via SyncToastPropagator).
 *
 * Zustand's vanilla subscribe hands over `(state, prevState)`; the
 * synced-store middleware replaces changed branches immutably, so reference
 * comparison per book/device finds remote updates without serializing the
 * per-device progress map on every store change.
 */
export function useSyncToasts() {
    const showToast = useToastStore(state => state.showToast);
    const currentDeviceId = getDeviceId();
    const lastToastTimeRef = useRef<Record<string, number>>({});

    useEffect(() => {
        const unsubscribe = useReadingStateStore.subscribe((state, prevState) => {
            const progress = state.progress;
            const oldProgress = prevState.progress;
            if (progress === oldProgress) return; // unrelated store change

            for (const bookId in progress) {
                const bookProgress = progress[bookId];
                const oldBookProgress = oldProgress[bookId];
                if (bookProgress === oldBookProgress) continue; // untouched book

                for (const deviceId in bookProgress) {
                    // Ignore local updates
                    if (deviceId === currentDeviceId) continue;

                    const newDeviceState = bookProgress[deviceId];
                    const oldDeviceState = oldBookProgress?.[deviceId];
                    if (newDeviceState === oldDeviceState) continue; // untouched device

                    // Check if this device updated significant progress
                    if (!oldDeviceState || (newDeviceState.lastRead > (oldDeviceState.lastRead || 0))) {
                        // Check for significant jump (> 5%) or completion
                        const percentDiff = (newDeviceState.percentage || 0) - (oldDeviceState?.percentage || 0);
                        const isJustCompleted = newDeviceState.percentage > 0.98 && (oldDeviceState?.percentage || 0) <= 0.98;

                        // Toasts throttling: max 1 per book per minute
                        const now = Date.now();
                        const lastToast = lastToastTimeRef.current[bookId] || 0;

                        if (now - lastToast > 60000) {
                            if (percentDiff > 0.05 || isJustCompleted) {
                                // Get book title
                                const book = useBookStore.getState().books[bookId];
                                const title = book?.title || 'a book';

                                if (isJustCompleted) {
                                    showToast(`Finished reading "${title}" on another device`, 'info');
                                    lastToastTimeRef.current[bookId] = now;
                                } else if (percentDiff > 0.05) {
                                    showToast(`Progress for "${title}" updated from another device`, 'info');
                                    lastToastTimeRef.current[bookId] = now;
                                }
                            }
                        }
                    }
                }
            }
        });

        return () => unsubscribe();
    }, [currentDeviceId, showToast]);
}
