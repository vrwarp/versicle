import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useDeviceStore } from '@store/useDeviceStore';
import { getDeviceId } from '@lib/device-id';
import { DeviceIcon } from '../devices/DeviceIcon';
import { Button } from '../ui/Button';

interface ResumeBadgeProps {
  bookId: string;
  /** Per-device progress map (UserProgress-shaped: currentCfi optional). */
  allProgress?: Record<string, { percentage: number; currentCfi?: string; lastRead: number }>;
  onResumeClick: (deviceId: string, cfi: string) => void;
}

/**
 * A badge that appears on a book card when a remote device has further reading progress.
 * Separated from BookCard to isolate useDeviceStore updates.
 */
export const ResumeBadge: React.FC<ResumeBadgeProps> = React.memo(({ allProgress, onResumeClick }) => {
  const currentDeviceId = getDeviceId();



  // Which remote device to offer is decided by the PROGRESS PROP alone — the
  // device store only supplies the label for it.
  const resumeInfo = useMemo(() => {
    if (!allProgress) return null;

    const localProgress = allProgress[currentDeviceId];
    const localPercentage = localProgress?.percentage || 0;
    const localLastRead = localProgress?.lastRead || 0;

    let bestRemote: { deviceId: string; percentage: number; cfi: string } | null = null;

    for (const [deviceId, progress] of Object.entries(allProgress)) {
      if (deviceId === currentDeviceId) continue;

      const remoteProgress = progress as { percentage?: number; lastRead?: number; currentCfi?: string };
      const remotePercentage = remoteProgress.percentage || 0;
      const remoteLastRead = remoteProgress.lastRead || 0;

      // Remote has further progress AND is more recent
      if (remotePercentage > localPercentage && remoteLastRead > localLastRead) {
        if (!bestRemote || remotePercentage > bestRemote.percentage) {
          bestRemote = {
            deviceId,
            percentage: remotePercentage,
            cfi: remoteProgress.currentCfi || ''
          };
        }
      }
    }

    return bestRemote;
  }, [allProgress, currentDeviceId]);

  // Subscribing to the whole `devices` map re-rendered EVERY mounted badge on
  // any device write — and the rolling embed-spend publisher writes that map
  // during a backfill. Only the resolved remote's two RENDERED fields are
  // subscribed here; useShallow keeps the reference while they are unchanged,
  // so an unrelated device (or another field of this one) notifies nothing.
  const { deviceName, platform } = useDeviceStore(
    useShallow((state) => {
      const device = resumeInfo ? state.devices[resumeInfo.deviceId] : undefined;
      return { deviceName: device?.name, platform: device?.platform };
    })
  );

  if (!resumeInfo) return null;

  return (
    <Button
      variant="default"
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        onResumeClick(resumeInfo.deviceId, resumeInfo.cfi);
      }}
      className="absolute bottom-[calc(100%-var(--cover-height)+1rem)] right-2 z-10 flex items-center gap-1 px-2 py-1 h-auto rounded-full text-xs font-medium shadow-md transition-colors translate-y-[-50%]"
      data-testid="resume-badge"
      title={`Continue from ${deviceName || 'Other device'} at ${Math.round(resumeInfo.percentage * 100)}%`}
      aria-label={`Continue from ${deviceName || 'Other device'} at ${Math.round(resumeInfo.percentage * 100)}%`}
      style={{ bottom: '90px' }} // Approximate position above text
    >
      <DeviceIcon platform={platform || ''} className="w-3 h-3" />
      <span>{Math.round(resumeInfo.percentage * 100)}%</span>
    </Button>
  );
});
