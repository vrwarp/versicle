import React, { useState, useEffect, useRef } from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { useReaderUIStore } from '../../store/useReaderUIStore';
import { useShallow } from 'zustand/react/shallow';
import { useSectionDuration } from '../../hooks/useSectionDuration';
import { ChevronsLeft, ChevronsRight, Play, Pause, StickyNote, Mic, Copy, X, Loader2, Check, BookOpen, ArrowUpCircle, Smartphone } from 'lucide-react';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

export type ActionType =
  | 'color'      // Payload: 'yellow' | 'green' | 'blue' | 'red'
  | 'note'       // Payload: string (the note text)
  | 'copy'       // Payload: null
  | 'pronounce'  // Payload: null
  | 'play'       // Payload: null
  | 'dismiss';   // Payload: null

interface CompassPillProps {
  variant: 'active' | 'summary' | 'compact' | 'annotation' | 'sync-alert';
  title?: string;
  subtitle?: string;
  progress?: number;
  onClick?: () => void;
  onAnnotationAction?: (action: ActionType, payload?: string) => void;
  availableActions?: {
    play?: boolean;
    pronounce?: boolean;
  };
}

export const CompassPill: React.FC<CompassPillProps> = ({
  variant,
  title,
  subtitle,
  progress: overrideProgress,
  onClick,
  onAnnotationAction,
  availableActions
}) => {
  const {
    isPlaying,
    status,
    queue,
    currentIndex,
    play,
    pause
  } = useTTSStore(useShallow(state => ({
    isPlaying: state.isPlaying,
    status: state.status,
    queue: state.queue,
    currentIndex: state.currentIndex,
    play: state.play,
    pause: state.pause
  })));

  const isLoading = status === 'loading';

  // Internal state for note editing
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset editing state when variant changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsEditingNote(false);
    setNoteText('');
  }, [variant]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditingNote && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditingNote]);

  // Clean up copy timeout
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    if (isCopied) {
      timeoutId = setTimeout(() => setIsCopied(false), 2000);
    }
    return () => clearTimeout(timeoutId);
  }, [isCopied]);

  // Optimize: Select only currentSectionTitle to prevent re-renders on progress/cfi updates
  const readerSectionTitle = useReaderUIStore(state => state.currentSectionTitle);

  const { timeRemaining, progress: hookProgress } = useSectionDuration();

  const progress = overrideProgress !== undefined ? overrideProgress : hookProgress;

  // Helper for chapter navigation
  const handleChapterNav = (direction: 'prev' | 'next') => {
    // Dispatch custom event for ReaderView to pick up
    // This ensures we always navigate chapters/pages, regardless of TTS status
    const event = new CustomEvent('reader:chapter-nav', { detail: { direction } });
    window.dispatchEvent(event);
  };

  const handleTogglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const handleSaveNote = () => {
    if (onAnnotationAction) {
      onAnnotationAction('note', noteText);
    }
    setIsEditingNote(false);
    setNoteText('');
  };

  const handleCancelNote = () => {
    setIsEditingNote(false);
    setNoteText('');
  };

  const currentItem = queue[currentIndex];
  // Title priority: Queue Item Title -> Reader Store Title -> "Section X"
  const sectionTitle = currentItem?.title || readerSectionTitle || `Section ${currentIndex + 1}`;

  const displayTitle = title || currentItem?.bookTitle || "Current Book";
  const displaySubtitle = subtitle || sectionTitle;

  // Annotation Mode
  if (variant === 'annotation') {
    if (isEditingNote) {
      return (
        <div
          data-testid="compass-pill-annotation-edit"
          className="relative z-50 flex flex-col justify-between w-full max-w-md mx-auto transition-all duration-300 bg-background/90 backdrop-blur-md border border-border shadow-2xl rounded-2xl p-3 min-h-[140px]"
        >
          <textarea
            ref={textareaRef}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note..."
            className="w-full h-24 p-2 bg-transparent resize-none focus:outline-none text-sm"
          />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" size="sm" onClick={handleCancelNote}>
              Cancel
            </Button>
            <Button variant="default" size="sm" onClick={handleSaveNote}>
              Save
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div
        data-testid="compass-pill-annotation"
        className="relative z-50 flex items-center justify-between w-full max-w-md h-14 px-4 mx-auto transition-all duration-300 bg-background/90 backdrop-blur-md border border-border shadow-2xl rounded-full"
      >
        {/* Left: Color Swatches */}
        <div className="flex items-center gap-2">
          {(['yellow', 'green', 'blue', 'red'] as const).map((color) => (
            <button
              key={color}
              data-testid={`popover-color-${color}`}
              className={cn(
                "w-6 h-6 rounded-full border border-border hover:scale-125 transition-transform",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
              )}
              style={{ backgroundColor: color === 'yellow' ? '#fde047' : color === 'green' ? '#86efac' : color === 'blue' ? '#93c5fd' : '#fca5a5' }}
              onClick={() => onAnnotationAction?.('color', color)}
              aria-label={`Highlight ${color}`}
            />
          ))}
        </div>

        {/* Right: Action Buttons */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full w-9 h-9"
            onClick={() => setIsEditingNote(true)}
            data-testid="popover-add-note-button"
            aria-label="Add Note"
          >
            <StickyNote size={18} />
          </Button>

          {availableActions?.pronounce && (
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full w-9 h-9"
              onClick={() => onAnnotationAction?.('pronounce')}
              data-testid="popover-fix-pronunciation-button"
              aria-label="Pronounce"
            >
              <Mic size={18} />
            </Button>
          )}

          {availableActions?.play && (
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full w-9 h-9"
              onClick={() => onAnnotationAction?.('play')}
              data-testid="popover-play-button"
              aria-label="Play from here"
            >
              <Play size={18} />
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="rounded-full w-9 h-9"
            onClick={() => {
              setIsCopied(true);
              onAnnotationAction?.('copy');
            }}
            data-testid="popover-copy-button"
            aria-label={isCopied ? "Copied" : "Copy text"}
          >
            {isCopied ? <Check size={18} className="text-green-500" /> : <Copy size={18} />}
          </Button>

          <div className="w-px h-6 bg-border mx-1" />

          <Button
            variant="ghost"
            size="icon"
            className="rounded-full w-9 h-9 text-muted-foreground hover:text-destructive"
            onClick={() => onAnnotationAction?.('dismiss')}
            data-testid="popover-close-button"
            aria-label="Dismiss"
          >
            <X size={18} />
          </Button>
        </div>
      </div>
    );
  }

  // Summary Mode
  if (variant === 'summary') {
    return (
      <div
        data-testid="compass-pill-summary"
        className={cn(
          "relative flex flex-col items-center justify-center w-full max-w-sm px-4 py-2 mx-auto overflow-hidden text-center transition-all border shadow-lg h-24 rounded-xl bg-background/75 backdrop-blur-md border-border",
          onClick && "cursor-pointer hover:bg-background/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        )}
        onClick={onClick}
        onKeyDown={(e) => {
          if (onClick && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onClick();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`Continue reading ${displayTitle}`}
      >
        <div className="text-xs font-bold truncate w-full opacity-90">
          {displayTitle}
        </div>
        <div className="text-xs font-medium truncate w-full opacity-80 my-1 flex items-center justify-center gap-1.5">
          <BookOpen size={12} className="opacity-70" aria-hidden="true" />
          {displaySubtitle}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {Math.round(progress)}% complete
        </div>
        {/* Progress Bar Background */}
        <div
          className="absolute bottom-0 left-0 h-1 bg-primary/20 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    );
  }

  // Compact Mode
  if (variant === 'compact') {
    return (
      <div data-testid="compass-pill-compact" className="relative z-40 flex items-center justify-center gap-1 w-fit h-14 px-2 mx-auto transition-all border shadow-lg rounded-full bg-background/75 backdrop-blur-md border-border">
        {/* Prev Button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-full text-primary hover:bg-primary/10 hover:text-primary touch-manipulation"
          onClick={() => handleChapterNav('prev')}
          aria-label="Previous"
        >
          <ChevronsLeft size={18} />
        </Button>

        {/* Play/Pause Button */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-11 w-11 rounded-full text-primary hover:bg-primary/10 hover:text-primary touch-manipulation",
            isLoading && "cursor-wait"
          )}
          onClick={handleTogglePlay}
          aria-label={isLoading ? "Loading..." : (isPlaying ? "Pause" : "Play")}
        >
          {isLoading ? (
            <Loader2 size={20} className="animate-spin" />
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
          aria-label="Next"
        >
          <ChevronsRight size={18} />
        </Button>
      </div>
    );
  }

  // Sync Alert Mode
  if (variant === 'sync-alert') {
    return (
      <div
        data-testid="compass-pill-sync-alert"
        className="relative z-50 flex items-center justify-between w-full max-w-sm h-14 px-4 mx-auto overflow-hidden transition-all border shadow-lg rounded-full bg-background/90 backdrop-blur-md border-primary/20 animate-in fade-in slide-in-from-bottom-2"
        role="alert"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (onClick) onClick();
          }
        }}>
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary animate-pulse">
            <Smartphone size={16} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-foreground truncate">
              {title || "Reading Progress Updated"}
            </span>
            <span className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
              <ArrowUpCircle size={10} />
              {subtitle || "Tap to sync location"}
            </span>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="rounded-full w-8 h-8 -mr-1 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onAnnotationAction?.('dismiss');
          }}
          aria-label="Dismiss update"
        >
          <X size={16} />
        </Button>
      </div>
    );
  }

  // Active Mode
  return (
    <div data-testid="compass-pill-active" className="relative z-40 flex items-center justify-between w-full max-w-md h-14 px-4 mx-auto overflow-hidden transition-all border shadow-lg rounded-full bg-background/75 backdrop-blur-md border-border">
      {/* Background Progress */}
      <div
        className="absolute inset-y-0 left-0 bg-primary/10 -z-10 transition-all duration-300"
        style={{ width: `${progress}%` }}
      />

      {/* Left Button */}
      <Button
        variant="ghost"
        className="h-11 w-11 rounded-full text-primary hover:bg-primary/10 hover:text-primary touch-manipulation"
        onClick={() => handleChapterNav('prev')}
        aria-label="Previous chapter"
      >
        <ChevronsLeft size={24} />
      </Button>

      {/* Center Info */}
      <div
        className={cn(
          "flex flex-col items-center justify-center flex-1 px-2 overflow-hidden cursor-pointer active:scale-95 transition-transform group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg",
          isLoading && "cursor-wait"
        )}
        onClick={handleTogglePlay}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleTogglePlay(e as unknown as React.MouseEvent);
          }
        }}
        role="button"
        tabIndex={0}
        data-testid="compass-active-toggle"
        aria-label={isLoading ? "Loading..." : (isPlaying ? "Pause" : "Play")}
      >
        <div className="text-sm font-bold tracking-wide uppercase truncate w-full text-center flex items-center justify-center gap-1.5">
          {isLoading ? (
            <Loader2 size={10} className="animate-spin opacity-70" data-testid="active-loader-icon" />
          ) : isPlaying ? (
            <Pause size={10} className="fill-current opacity-70" data-testid="active-pause-icon" />
          ) : (
            <Play size={10} className="fill-current opacity-70 ml-0.5" data-testid="active-play-icon" />
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
        aria-label="Next chapter"
      >
        <ChevronsRight size={24} />
      </Button>
    </div>
  );
};
