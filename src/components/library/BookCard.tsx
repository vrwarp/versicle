import React from 'react';
import { Smartphone, Monitor, Tablet, MoreVertical, Play, Trash2, CloudOff, RotateCcw } from 'lucide-react';
import type { BookMetadata } from '../../types/db';
import { BookCover } from './BookCover';
import { useReadingStateStore, useBookProgress } from '../../store/useReadingStateStore';
import { useDeviceStore } from '../../store/useDeviceStore';
import { getDeviceId } from '../../lib/device-id';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '../ui/DropdownMenu';
import { Button } from '../ui/Button';

/**
 * Props for the BookCard component.
 */
interface BookCardProps {
  /** The metadata of the book to display. */
  book: BookMetadata;
  /** Whether this is a Ghost Book (synced metadata but no local file) */
  isGhostBook?: boolean;
  onOpen: (book: BookMetadata) => void;
  onDelete: (book: BookMetadata) => void;
  onOffload: (book: BookMetadata) => void;
  onRestore: (book: BookMetadata) => void;
  /** Optional callback when resume badge is clicked */
  onResume?: (book: BookMetadata, deviceId: string, cfi: string) => void;
}

const formatDuration = (chars?: number): string => {
  if (!chars) return '';
  const minutes = Math.ceil(chars / (180 * 5));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Gets the device icon based on platform name
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
 * Displays a summary card for a book, including its cover, title, and author.
 * navigating to the reader view when clicked.
 *
 * @param props - Component props containing the book metadata.
 * @returns A React component rendering the book card.
 */
export const BookCard: React.FC<BookCardProps> = React.memo(({
  book,
  isGhostBook = false,
  onOpen,
  onDelete,
  onOffload,
  onRestore,
  onResume
}) => {
  const currentDeviceId = getDeviceId();

  // Get active progress using the shared priority logic
  const activeProgress = useBookProgress(book.id);
  // Use book.progress (from usage in selectors) as fallback if activeProgress is missing
  // This ensures Reading List progress is used if no device progress exists
  const progressPercent = activeProgress ? activeProgress.percentage : (book.progress || 0);

  // Get raw progress from all devices to calculate resume badge
  const allProgress = useReadingStateStore((state) => state.progress[book.id]);
  const devices = useDeviceStore((state) => state.devices);

  // Find if any remote device has further progress
  const resumeInfo = React.useMemo(() => {
    if (!allProgress) return null;

    const localProgress = allProgress[currentDeviceId];
    const localPercentage = localProgress?.percentage || 0;
    const localLastRead = localProgress?.lastRead || 0;

    // Find the remote device with the furthest progress that's more recent
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

  // Get list of all remote sessions for the context menu
  const remoteSessions = React.useMemo(() => {
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

  const handleCardClick = () => {
    if (book.isOffloaded || isGhostBook) {
      onRestore(book);
    } else {
      onOpen(book);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick();
    }
  };

  const handleResumeBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (resumeInfo && onResume) {
      onResume(book, resumeInfo.deviceId, resumeInfo.cfi);
    }
  };

  const handleMenuResume = (e: React.MouseEvent, deviceId: string, cfi: string) => {
    e.stopPropagation();
    if (onResume) {
      onResume(book, deviceId, cfi);
    }
  };

  const durationString = book.totalChars ? formatDuration(book.totalChars) : null;

  return (
    <div
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      data-testid={`book-card-${book.id}`}
      className="group flex flex-col bg-card text-card-foreground rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden border border-border h-full cursor-pointer relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-full max-w-[240px]"
    >
      <div className="relative">
        <BookCover
          book={book}
          isGhostBook={isGhostBook}
          onDelete={() => onDelete(book)}
          onOffload={() => onOffload(book)}
          onRestore={() => onRestore(book)}
          showActions={false}
        />

        {/* Dropdown Menu Trigger - Always visible on touch, visible on hover/focus on desktop */}
        <div className="absolute top-2 right-2 z-20 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity focus-within:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="h-8 w-8 rounded-full shadow-md bg-background/80 backdrop-blur-sm"
                onClick={(e) => e.stopPropagation()}
                data-testid="book-context-menu-trigger"
              >
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">Book options</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onOpen(book); }}>
                <Play className="mr-2 h-4 w-4" />
                <span>Open</span>
              </DropdownMenuItem>

              {remoteSessions.length > 0 && onResume && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Monitor className="mr-2 h-4 w-4" />
                    <span>Resume from...</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-48">
                    {remoteSessions.map((session) => (
                      <DropdownMenuItem
                        key={session.deviceId}
                        onClick={(e) => handleMenuResume(e, session.deviceId, session.cfi)}
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
              )}

              <DropdownMenuSeparator />

              {book.isOffloaded ? (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRestore(book); }} data-testid="menu-restore">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  <span>Restore Download</span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onOffload(book); }} data-testid="menu-offload">
                  <CloudOff className="mr-2 h-4 w-4" />
                  <span>Remove Download</span>
                </DropdownMenuItem>
              )}

              <DropdownMenuItem
                onClick={(e) => { e.stopPropagation(); onDelete(book); }}
                className="text-destructive focus:text-destructive"
                data-testid="menu-delete"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                <span>Delete from Library</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Resume Badge - shows when remote device has further progress */}
      {resumeInfo && (
        <button
          onClick={handleResumeBadgeClick}
          className="absolute bottom-[calc(100%-var(--cover-height)+1rem)] right-2 z-10 flex items-center gap-1 px-2 py-1 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-md hover:bg-primary/90 transition-colors translate-y-[-50%]"
          data-testid="resume-badge"
          title={`Continue from ${resumeInfo.deviceName} at ${Math.round(resumeInfo.percentage * 100)}%`}
          aria-label={`Continue from ${resumeInfo.deviceName} at ${Math.round(resumeInfo.percentage * 100)}%`}
          style={{ bottom: '90px' }} // Approximate position above text
        >
          <DeviceIcon platform={devices[resumeInfo.deviceId]?.platform || ''} className="w-3 h-3" />
          <span>{Math.round(resumeInfo.percentage * 100)}%</span>
        </button>
      )}

      <div className="p-3 flex flex-col flex-1">
        <h3 data-testid="book-title" className="font-semibold text-foreground line-clamp-2 mb-1" title={book.title}>
          {book.title}
        </h3>
        <p className="text-sm text-muted-foreground line-clamp-1" title={book.author}>
          {book.author || 'Unknown Author'}
        </p>

        {durationString && (
          <p className="text-xs text-muted-foreground mt-1">
            {durationString}
          </p>
        )}

        {progressPercent > 0 && (
          <div
            className="w-full h-1.5 bg-secondary rounded-full mt-3 overflow-hidden"
            data-testid="progress-container"
            role="progressbar"
            aria-valuenow={Math.round(progressPercent * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Reading progress: ${Math.round(progressPercent * 100)}%`}
          >
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, progressPercent * 100))}%` }}
              data-testid="progress-bar"
            />
          </div>
        )}
      </div>
    </div>
  );
});
