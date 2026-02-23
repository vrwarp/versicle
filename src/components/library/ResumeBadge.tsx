import React, { useMemo } from 'react';
import { useReadingStateStore } from '../../store/useReadingStateStore';
import { useDeviceStore } from '../../store/useDeviceStore';
import { getDeviceId } from '../../lib/device-id';
import { DeviceIcon } from '../devices/DeviceIcon';

interface ResumeBadgeProps {
  bookId: string;
  onResumeClick: (deviceId: string, cfi: string) => void;
}

/**
 * A badge that appears on a book card when a remote device has further reading progress.
 * Separated from BookCard to isolate useDeviceStore updates.
 */
export const ResumeBadge: React.FC<ResumeBadgeProps> = React.memo(({ bookId, onResumeClick }) => {
  const currentDeviceId = getDeviceId();

  // Get raw progress from all devices
  // This selector is fine because it's specific to the book
  const allProgress = useReadingStateStore((state) => state.progress?.[bookId]);

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
    <button
      onClick={(e) => {
        e.stopPropagation();
        onResumeClick(resumeInfo.deviceId, resumeInfo.cfi);
      }}
      className="absolute bottom-[calc(100%-var(--cover-height)+1rem)] right-2 z-10 flex items-center gap-1 px-2 py-1 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-md hover:bg-primary/90 transition-colors translate-y-[-50%]"
      data-testid="resume-badge"
      title={`Continue from ${resumeInfo.deviceName} at ${Math.round(resumeInfo.percentage * 100)}%`}
      aria-label={`Continue from ${resumeInfo.deviceName} at ${Math.round(resumeInfo.percentage * 100)}%`}
      style={{ bottom: '90px' }} // Approximate position above text
    >
      <DeviceIcon platform={devices[resumeInfo.deviceId]?.platform || ''} className="w-3 h-3" />
      <span>{Math.round(resumeInfo.percentage * 100)}%</span>
    </button>
  );
});
