import React, { useMemo } from 'react';
import { Monitor } from 'lucide-react';
import { useReadingStateStore } from '../../store/useReadingStateStore';
import { useDeviceStore } from '../../store/useDeviceStore';
import { getDeviceId } from '../../lib/device-id';
import { DeviceIcon } from '../devices/DeviceIcon';
import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuItem
} from '../ui/DropdownMenu';

interface RemoteSessionsSubMenuProps {
  bookId: string;
  onResumeClick: (deviceId: string, cfi: string) => void;
}

/**
 * A submenu that lists other devices with reading progress for this book.
 * Separated from BookCard to isolate useDeviceStore updates.
 */
export const RemoteSessionsSubMenu: React.FC<RemoteSessionsSubMenuProps> = React.memo(({ bookId, onResumeClick }) => {
  const currentDeviceId = getDeviceId();

  const allProgress = useReadingStateStore((state) => state.progress[bookId]);
  // Isolate expensive store updates to this component only
  const devices = useDeviceStore((state) => state.devices);

  // Get list of all remote sessions for the context menu
  const remoteSessions = useMemo(() => {
    if (!allProgress) return [];
    return Object.entries(allProgress)
      .filter(([deviceId]) => deviceId !== currentDeviceId)
      .map(([deviceId, progress]) => {
        const p = progress as { percentage?: number; lastRead?: number; currentCfi?: string };
        const device = devices[deviceId];
        return {
          deviceId,
          name: device?.name || 'Unknown Device',
          platform: device?.platform || 'desktop',
          percentage: p.percentage || 0,
          cfi: p.currentCfi || '',
          lastRead: p.lastRead || 0
        };
      })
      .sort((a, b) => b.lastRead - a.lastRead);
  }, [allProgress, currentDeviceId, devices]);

  if (remoteSessions.length === 0) return null;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Monitor className="mr-2 h-4 w-4" />
        <span>Resume from...</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-48">
        {remoteSessions.map((session) => (
          <DropdownMenuItem
            key={session.deviceId}
            onClick={(e) => {
              e.stopPropagation();
              onResumeClick(session.deviceId, session.cfi);
            }}
          >
            <DeviceIcon platform={session.platform} className="mr-2 h-4 w-4 opacity-70" />
            <div className="flex flex-col gap-0.5">
              <span>{session.name}</span>
              <span className="text-xs text-muted-foreground">
                {Math.round(session.percentage * 100)}% • {new Date(session.lastRead).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
});
