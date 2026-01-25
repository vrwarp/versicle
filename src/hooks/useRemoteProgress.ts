import React from 'react';
import { useReadingStateStore } from '../store/useReadingStateStore';
import { useDeviceStore } from '../store/useDeviceStore';
import { getDeviceId } from '../lib/device-id';

export interface RemoteProgressInfo {
    deviceId: string;
    deviceName: string;
    platform: string;
    percentage: number;
    cfi: string;
    timestamp: number;
}

/**
 * Hook to check if there is a remote device with further progress for the given book.
 * Returns the "best" remote progress (furthest + most recent) if it exceeds local progress.
 */
export function useRemoteProgress(bookId: string | null): RemoteProgressInfo | null {
    const currentDeviceId = getDeviceId();

    // Subscribe to progress for this book
    const allProgress = useReadingStateStore((state) => bookId ? state.progress[bookId] : undefined);
    const devices = useDeviceStore((state) => state.devices);

    return React.useMemo(() => {
        if (!bookId || !allProgress) return null;

        const localProgress = allProgress[currentDeviceId];
        const localPercentage = localProgress?.percentage || 0;
        const localLastRead = localProgress?.lastRead || 0;

        let best: RemoteProgressInfo | null = null;

        for (const [deviceId, progress] of Object.entries(allProgress)) {
            if (deviceId === currentDeviceId) continue;

            const remote = progress as { percentage?: number; lastRead?: number; currentCfi?: string };
            const remotePercentage = remote.percentage || 0;
            const remoteLastRead = remote.lastRead || 0;

            // Condition: Remote is further AND more recent than local
            if (remotePercentage > localPercentage && remoteLastRead > localLastRead) {
                const device = devices[deviceId];
                const deviceName = device?.name || 'Another device';
                const platform = device?.platform || 'unknown';

                // Find the absolute best candidate among remotes
                if (!best || remotePercentage > best.percentage) {
                    best = {
                        deviceId,
                        deviceName,
                        platform,
                        percentage: remotePercentage,
                        cfi: remote.currentCfi || '',
                        timestamp: remoteLastRead
                    };
                }
            }
        }

        return best;
    }, [allProgress, currentDeviceId, devices, bookId]);
}
