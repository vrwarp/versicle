import React, { useMemo } from 'react';

import { useDeviceStore } from '../../store/useDeviceStore';
import { getDeviceId } from '../../lib/device-id';
import { DeviceIcon } from '../devices/DeviceIcon';
import { Button } from '../ui/Button';

interface ResumeBadgeProps {
  bookId: string;
  allProgress?: Record<string, { percentage: number; currentCfi: string; lastRead: number }>;
  onResumeClick: (deviceId: string, cfi: string) => void;
}

/**
 * A badge that appears on a book card when a remote device has further reading progress.
 * Separated from BookCard to isolate useDeviceStore updates.
 */
export const ResumeBadge: React.FC<ResumeBadgeProps> = React.memo(({ allProgress, onResumeClick }) => {
  const currentDeviceId = getDeviceId();



  // This selector returns the entire devices object, causing re-renders on ANY device update.
  // By isolating this in ResumeBadge, we prevent the heavy BookCard from re-rendering.
  const devices = useDeviceStore((state) => state.devices);

  const resumeInfo = useMemo(() => {
    if (!allProgress) return null;

    const localProgress = allProgress[currentDeviceId];
    const localPercentage = localProgress?.percentage || 0;
    const localLastRead = localProgress?.lastRead || 0;

    let bestRemote: { deviceId: string; percentage: number; cfi: string; deviceName: string } | null = null;

    for (const [deviceId, progress] of Object.entries(allProgress)) {
      if (deviceId === currentDeviceId) continue;

      const remoteProgress = progress as { percentage?: number; lastRead?: number; currentCfi?: string };
      const remotePercentage = remoteProgress.percentage || 0;
      const remoteLastRead = remoteProgress.lastRead || 0;

      // Remote has further progress AND is more recent
      if (remotePercentage > localPercentage && remoteLastRead > localLastRead) {
        const device = devices[deviceId];
        const deviceName = device?.name || 'Other device';

        if (!bestRemote || remotePercentage > bestRemote.percentage) {
          bestRemote = {
            deviceId,
            percentage: remotePercentage,
            cfi: remoteProgress.currentCfi || '',
            deviceName
          };
        }
      }
    }

    return bestRemote;
  }, [allProgress, currentDeviceId, devices]);

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
      title={`Continue from ${resumeInfo.deviceName} at ${Math.round(resumeInfo.percentage * 100)}%`}
      aria-label={`Continue from ${resumeInfo.deviceName} at ${Math.round(resumeInfo.percentage * 100)}%`}
      style={{ bottom: '90px' }} // Approximate position above text
    >
      <DeviceIcon platform={devices[resumeInfo.deviceId]?.platform || ''} className="w-3 h-3" />
      <span>{Math.round(resumeInfo.percentage * 100)}%</span>
    </Button>
  );
});
