/**
 * AudioPill — the playback pill ('active' full bar / 'compact' immersive
 * bar), extracted from the dissolved ui/CompassPill (Phase 8 §C). ONE
 * component for both layouts so the immersive-mode morph re-renders
 * instead of remounting (the focus-destroying `key={variant}` remount was
 * a11y item 8). Chapter navigation goes through the ReaderCommands
 * registry — the pill stays TTS-agnostic, exactly like the CustomEvent
 * dispatch the registry replaced (P6).
 */
import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChevronsLeft, ChevronsRight, Play, Pause, Loader2, LocateFixed } from 'lucide-react';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useAudioCommands } from '@app/tts/useAudioCommands';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { useBookStore } from '@store/useBookStore';
import { useSectionDuration } from '@hooks/useSectionDuration';
import { readerCommandsRegistry } from '@domains/reader/ui/ReaderCommands';
import { PillShell } from '../../ui/PillShell';
import { Button } from '../../ui/Button';
import { cn } from '@lib/utils';

export interface AudioPillProps {
  /** Immersive-mode compact layout (icon bar) instead of the full pill. */
  compact?: boolean;
  title?: string;
  subtitle?: string;
  /** Section progress override (0–100); defaults to the TTS-derived value. */
  progress?: number;
}

export const AudioPill: React.FC<AudioPillProps> = ({
  compact = false,
  title,
  subtitle,
  progress: overrideProgress,
}) => {
  const currentBookId = useReaderUIStore(state => state.currentBookId);
  const book = useBookStore(state => currentBookId ? state.books[currentBookId] : null);
  // Optimize: Select only currentSectionTitle to prevent re-renders on progress/cfi updates
  const readerSectionTitle = useReaderUIStore(state => state.currentSectionTitle);

  // Audio-follow ("navigation") state: when the user has scrolled away mid
  // playback, this pill surfaces a re-center button that snaps the page back
  // to the spoken sentence (ReaderTTSController reacts to the flag flip).
  const followingAudio = useReaderUIStore(state => state.followingAudio);
  const setFollowingAudio = useReaderUIStore(state => state.setFollowingAudio);

  const { isPlaying, status, queue, currentIndex } = useTTSPlaybackStore(useShallow(state => ({
    isPlaying: state.isPlaying,
    status: state.status,
    queue: state.queue,
    currentIndex: state.currentIndex
  })));

  // Engine commands come from the TtsController facade (stable identities).
  const { play, pause } = useAudioCommands();

  const { timeRemaining, progress: hookProgress } = useSectionDuration();
  const progress = overrideProgress !== undefined ? overrideProgress : hookProgress;

  const isLoading = status === 'loading';

  // The pill is a pure audio transport (compass-pill rework Phase 1): the
  // prev/next arrows skip TTS sections and carry ONE meaning regardless of
  // playback state. They are disabled when there is no audio session — page
  // turning moved to the reading surface (PageTurnRails + the ArrowLeft/Right
  // shortcuts), so the arrows no longer flip between "page" and "chapter" under
  // the user. Kept present-but-disabled (not hidden) to avoid the layout shift
  // and focus loss of a control that mounts/unmounts with playback state.
  const navDisabled = status === 'stopped';

  // Chapter navigation: the reader's command registry (the TTS-aware
  // routing lives in nextChapter/prevChapter — this pill stays agnostic).
  // Null when no reader is open; the nav arrows are then no-ops, matching
  // the legacy listener absence.
  const handleChapterNav = (direction: 'prev' | 'next') => {
    const commands = readerCommandsRegistry.get();
    if (!commands) return;
    if (direction === 'next') commands.nextChapter();
    else commands.prevChapter();
  };

  const handleTogglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLoading) return;
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  // Format time remaining: -MM:SS
  const formatTime = (minutes: number) => {
    const m = Math.floor(minutes);
    const s = Math.floor((minutes - m) * 60);
    return `-${m}:${s.toString().padStart(2, '0')} remaining`;
  };

  // Format time remaining for screen readers
  const formatTimeAccessible = (minutes: number) => {
    const m = Math.floor(minutes);
    const s = Math.floor((minutes - m) * 60);
    const parts = [];
    if (m > 0) parts.push(`${m} minute${m !== 1 ? 's' : ''}`);
    if (s > 0) parts.push(`${s} second${s !== 1 ? 's' : ''}`);
    return parts.length > 0 ? `${parts.join(' ')} remaining` : 'less than a second remaining';
  };

  const currentItem = queue[currentIndex];
  // Title priority: Subtitle Prop (real-time toggle) -> Queue Item Title -> Reader Store Title -> "Section X"
  const sectionTitle = subtitle || currentItem?.title || readerSectionTitle || `Section ${currentIndex + 1}`;
  const displayTitle = title || book?.title || "Current Book";

  const handleRecenter = (e: React.MouseEvent) => {
    e.stopPropagation();
    // The flag flip is the whole action: ReaderTTSController re-runs its sync
    // effect and snaps the page to the current sentence (this pill stays
    // reader-agnostic, like the rest of its controls).
    setFollowingAudio(true);
  };

  // Surface the re-center affordance only when audio is live AND the user has
  // scrolled off the spoken sentence — exactly the maps "re-center" chip.
  const showRecenter = status !== 'stopped' && !followingAudio;

  // Floating chip above the pill (a sibling, so the pill's own layout is
  // untouched in both the active and compact morphs).
  const recenterChip = showRecenter ? (
    <button
      type="button"
      data-testid="audio-recenter-button"
      onClick={handleRecenter}
      aria-label="Re-center on the current sentence"
      className="absolute left-1/2 -translate-x-1/2 -top-12 z-50 flex items-center gap-1.5 h-9 px-3 rounded-full border border-border bg-background/75 text-xs font-semibold text-primary shadow-lg backdrop-blur-md hover:bg-primary/10 touch-manipulation animate-in fade-in slide-in-from-bottom-1"
    >
      <LocateFixed size={16} aria-hidden="true" />
      <span>Re-center</span>
    </button>
  ) : null;

  if (compact) {
    return (
      <div className="relative w-full flex justify-center">
        {recenterChip}
        <PillShell
        data-testid="compass-pill-compact"
        className="z-40 flex items-center justify-center gap-1 w-fit h-14 px-2"
      >
        {/* Prev Button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-full text-primary hover:bg-primary/10 hover:text-primary touch-manipulation"
          onClick={() => handleChapterNav('prev')}
          disabled={navDisabled}
          aria-label="Previous chapter"
        >
          <ChevronsLeft size={18} />
        </Button>

        {/* Play/Pause Button */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-11 w-11 rounded-full text-primary hover:bg-primary/10 hover:text-primary touch-manipulation",
            isLoading && "cursor-wait opacity-80"
          )}
          onClick={handleTogglePlay}
          aria-disabled={isLoading}
          aria-pressed={isPlaying}
          aria-label={
            isLoading
              ? "Loading..."
              : `${isPlaying ? "Pause" : "Play"} ${displayTitle}`
          }
        >
          {isLoading ? (
            <Loader2 size={20} className="animate-spin" aria-hidden="true" />
          ) : isPlaying ? (
            <Pause size={20} className="fill-current" />
          ) : (
            <Play size={20} className="fill-current ml-0.5" />
          )}
        </Button>

        {/* Next Button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-full text-primary hover:bg-primary/10 hover:text-primary touch-manipulation"
          onClick={() => handleChapterNav('next')}
          disabled={navDisabled}
          aria-label="Next chapter"
        >
          <ChevronsRight size={18} />
        </Button>
        </PillShell>
      </div>
    );
  }

  return (
    <div className="relative w-full flex justify-center">
      {recenterChip}
      <PillShell
      data-testid="compass-pill-active"
      className="z-40 flex items-center justify-between w-full max-w-md h-14 px-4"
      progress={progress}
      progressTestId="compass-pill-progress-bar"
    >
      {/* Left Button */}
      <Button
        variant="ghost"
        className="h-11 w-11 rounded-full text-primary hover:bg-primary/10 hover:text-primary touch-manipulation"
        onClick={() => handleChapterNav('prev')}
        disabled={navDisabled}
        aria-label="Previous chapter"
      >
        <ChevronsLeft size={24} />
      </Button>

      {/* Center Info */}
      <div
        className={cn(
          "flex flex-col items-center justify-center flex-1 px-2 overflow-hidden cursor-pointer active:scale-95 transition-transform group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg",
          isLoading && "cursor-wait opacity-80 active:scale-100"
        )}
        onClick={handleTogglePlay}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.target !== e.currentTarget) return;
            e.preventDefault();
            handleTogglePlay(e as unknown as React.MouseEvent);
          }
        }}
        role="button"
        tabIndex={0}
        data-testid="compass-active-toggle"
        aria-disabled={isLoading}
        aria-pressed={isPlaying}
        aria-label={
          isLoading
            ? "Loading..."
            : `${isPlaying ? "Pause" : "Play"} ${sectionTitle}, ${formatTimeAccessible(timeRemaining)}`
        }
      >
        <div className="text-sm font-bold tracking-wide uppercase truncate w-full text-center flex items-center justify-center gap-1.5">
          {isLoading ? (
            <Loader2 size={16} className="animate-spin opacity-70" data-testid="active-loader-icon" aria-hidden="true" />
          ) : isPlaying ? (
            <Pause size={16} className="fill-current opacity-70" data-testid="active-pause-icon" />
          ) : (
            <Play size={16} className="fill-current opacity-70 ml-0.5" data-testid="active-play-icon" />
          )}
          <span className="truncate">{sectionTitle}</span>
        </div>
        <div className="text-xs font-mono text-muted-foreground">
          {formatTime(timeRemaining)}
        </div>
      </div>

      {/* Right Button */}
      <Button
        variant="ghost"
        className="h-11 w-11 rounded-full text-primary hover:bg-primary/10 hover:text-primary touch-manipulation"
        onClick={() => handleChapterNav('next')}
        disabled={navDisabled}
        aria-label="Next chapter"
      >
        <ChevronsRight size={24} />
      </Button>
      </PillShell>
    </div>
  );
};
