import { useEffect, useRef } from 'react';
import { useReadingStateStore } from '../../../store/useReadingStateStore';
import { getDeviceId } from '../../device-id';
import { useToastStore } from '../../../store/useToastStore';
import { useBookStore } from '../../../store/useLibraryStore';

/**
 * Hook to show toast notifications when sync events occur from other devices.
 */
import type { UserProgress } from '../../../types/db';

export function useSyncToasts() {
    const showToast = useToastStore(state => state.showToast);
    const currentDeviceId = getDeviceId();
    const lastProgressRef = useRef<Record<string, Record<string, UserProgress>> | null>(null);
    const lastToastTimeRef = useRef<Record<string, number>>({});

    useEffect(() => {
        const unsubscribe = useReadingStateStore.subscribe((state) => {
            const progress = state.progress;

            // Reference stability check
            if (lastProgressRef.current && lastProgressRef.current !== progress) {
                const oldProgress = lastProgressRef.current;

                for (const bookId in progress) {
                    const bookProgress = progress[bookId];
                    const oldBookProgress = oldProgress[bookId];

                    // If this book hasn't changed at all, skip
                    if (bookProgress === oldBookProgress) continue;

                    for (const deviceId in bookProgress) {
                        // Ignore local updates
                        if (deviceId === currentDeviceId) continue;

                        const newDeviceState = bookProgress[deviceId];
                        const oldDeviceState = oldBookProgress?.[deviceId];

                        // If this device's progress hasn't changed, skip
                        if (newDeviceState === oldDeviceState) continue;

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
            }

            lastProgressRef.current = progress;
        });

        return () => unsubscribe();
    }, [currentDeviceId, showToast]);
}
