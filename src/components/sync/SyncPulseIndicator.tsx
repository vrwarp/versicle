import React, { useMemo } from 'react';
import { cn } from '../../lib/utils';
import { useSyncStore } from '../../lib/sync/hooks/useSyncStore';
import type { FirestoreSyncStatus } from '../../lib/sync/FirestoreSyncManager';

/**
 * Sync Pulse Indicator
 * 
 * A visual indicator of sync activity for the library header.
 * Shows a pulsing dot when syncing, grey when idle, red on error.
 */
interface SyncPulseIndicatorProps {
    className?: string;
    showTooltip?: boolean;
}

const SyncIcon: React.FC<{ status: FirestoreSyncStatus }> = ({ status }) => {
    // Determine color based on status
    const colorClass = useMemo(() => {
        switch (status) {
            case 'connected': return 'bg-green-500';
            case 'connecting': return 'bg-blue-500';
            case 'error': return 'bg-red-500';
            case 'disconnected': default: return 'bg-slate-300 dark:bg-slate-700';
        }
    }, [status]);

    return (
        <div className="relative flex h-3 w-3">
            {(status === 'connecting' || status === 'connected') && (
                <span className={cn(
                    "animate-ping-slow absolute inline-flex h-full w-full rounded-full opacity-75",
                    colorClass
                )}></span>
            )}
            <span className={cn(
                "relative inline-flex rounded-full h-3 w-3 transition-colors duration-300",
                colorClass
            )}></span>
        </div>
    );
};

export const SyncPulseIndicator: React.FC<SyncPulseIndicatorProps> = ({
    className
}) => {
    // SyncStore does not expose 'error', rely on status === 'error'
    const { firestoreStatus, lastSyncTime } = useSyncStore();

    // Map store status (with firestore prefix) to local concept
    const status = firestoreStatus;

    // Use derived state for visual feedback
    const isError = status === 'error';

    const titleText = useMemo(() => {
        if (isError) return `Sync Error`; // Detailed error not in store currently
        if (status === 'connected') {
            const timeStr = lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString() : 'Just now';
            return `Synced (Last: ${timeStr})`;
        }
        if (status === 'connecting') return 'Syncing...';
        return 'Not Synced';
    }, [status, isError, lastSyncTime]);

    return (
        <div
            className={cn("flex items-center gap-2", className)}
            title={titleText}
            data-testid="sync-pulse-indicator"
        >
            <SyncIcon status={status} />
            {isError && (
                <span className="text-xs text-destructive hidden sm:inline-block">Sync Error</span>
            )}
        </div>
    );
};
