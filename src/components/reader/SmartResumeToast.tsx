import React, { useState, useEffect } from 'react';
import { Monitor, Smartphone, Tablet, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';
import { useReadingStateStore } from '../../store/useReadingStateStore';
import { useDeviceStore } from '../../store/useDeviceStore';
import { getDeviceId } from '../../lib/device-id';

interface SmartResumeToastProps {
    /** The book ID to check progress for */
    bookId: string;
    /** Callback when user clicks "Jump" */
    onJump: (cfi: string, deviceId: string) => void;
    /** Callback when user dismisses the toast */
    onDismiss: (deviceId: string) => void;
    /** Additional CSS classes */
    className?: string;
}

interface RemoteProgressInfo {
    deviceId: string;
    deviceName: string;
    platform: string;
    percentage: number;
    cfi: string;
    chapterHint?: string;
}

/**
 * Device icon component
 */
const DeviceIcon: React.FC<{ platform: string; className?: string }> = ({ platform, className }) => {
    const lower = platform.toLowerCase();
    if (lower.includes('mobile') || lower.includes('phone') || lower.includes('android') || lower.includes('ios')) {
        return <Smartphone className={className} />;
    }
    if (lower.includes('tablet') || lower.includes('ipad')) {
        return <Tablet className={className} />;
    }
    return <Monitor className={className} />;
};

/**
 * Floating toast that appears when the user has made progress on another device.
 * Provides a quick action to "Jump" to the remote location.
 */
export const SmartResumeToast: React.FC<SmartResumeToastProps> = ({
    bookId,
    onJump,
    onDismiss,
    className
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const [dismissedDevices, setDismissedDevices] = useState<Set<string>>(new Set());

    const currentDeviceId = getDeviceId();
    const allProgress = useReadingStateStore((state) => state.progress[bookId]);
    const devices = useDeviceStore((state) => state.devices);

    // Calculate if there's a remote device with further progress
    const remoteInfo: RemoteProgressInfo | null = React.useMemo(() => {
        if (!allProgress) return null;

        const localProgress = allProgress[currentDeviceId];
        const localPercentage = localProgress?.percentage || 0;
        const localLastRead = localProgress?.lastRead || 0;

        let best: RemoteProgressInfo | null = null;

        for (const [deviceId, progress] of Object.entries(allProgress)) {
            if (deviceId === currentDeviceId) continue;
            if (dismissedDevices.has(deviceId)) continue;

            const remote = progress as { percentage?: number; lastRead?: number; currentCfi?: string };
            const remotePercentage = remote.percentage || 0;
            const remoteLastRead = remote.lastRead || 0;

            // Remote is further AND more recent
            if (remotePercentage > localPercentage && remoteLastRead > localLastRead) {
                const device = devices[deviceId];
                const deviceName = device?.name || 'Another device';
                const platform = device?.platform || '';

                if (!best || remotePercentage > best.percentage) {
                    best = {
                        deviceId,
                        deviceName,
                        platform,
                        percentage: remotePercentage,
                        cfi: remote.currentCfi || '',
                        chapterHint: undefined // Could be enhanced with TOC lookup
                    };
                }
            }
        }

        return best;
    }, [allProgress, currentDeviceId, devices, dismissedDevices]);

    // Show/hide based on remote info
    useEffect(() => {
        if (remoteInfo) {
            // Small delay to avoid immediate popup
            const timer = setTimeout(() => setIsVisible(true), 500);
            return () => clearTimeout(timer);
        } else {
            setIsVisible(false);
        }
    }, [remoteInfo]);

    const handleJump = () => {
        if (remoteInfo) {
            onJump(remoteInfo.cfi, remoteInfo.deviceId);
            setDismissedDevices(prev => new Set(prev).add(remoteInfo.deviceId));
            setIsVisible(false);
        }
    };

    const handleDismiss = () => {
        if (remoteInfo) {
            onDismiss(remoteInfo.deviceId);
            setDismissedDevices(prev => new Set(prev).add(remoteInfo.deviceId));
            setIsVisible(false);
        }
    };

    if (!isVisible || !remoteInfo) return null;

    return (
        <div
            className={cn(
                "fixed bottom-20 left-1/2 -translate-x-1/2 z-50",
                "bg-background border border-border rounded-full shadow-lg",
                "px-4 py-2 flex items-center gap-3",
                "animate-in slide-in-from-bottom-4 fade-in duration-300",
                className
            )}
            role="alert"
            aria-live="polite"
            data-testid="smart-resume-toast"
        >
            <DeviceIcon platform={remoteInfo.platform} className="w-4 h-4 text-muted-foreground shrink-0" />

            <span className="text-sm">
                Pick up where you left off on <strong>{remoteInfo.deviceName}</strong>?
                <span className="text-muted-foreground ml-1">
                    {Math.round(remoteInfo.percentage * 100)}%
                </span>
            </span>

            <div className="flex items-center gap-1">
                <Button
                    size="sm"
                    onClick={handleJump}
                    className="h-7 px-3 text-xs"
                    data-testid="resume-jump-button"
                >
                    Jump
                </Button>
                <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleDismiss}
                    className="h-7 w-7"
                    aria-label="Dismiss"
                    data-testid="resume-dismiss-button"
                >
                    <X className="w-4 h-4" />
                </Button>
            </div>
        </div>
    );
};
