import React, { useState, useEffect, useRef } from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { useReaderStore } from '../../store/useReaderStore';
import { useShallow } from 'zustand/react/shallow';
import { useChapterDuration } from '../../hooks/useChapterDuration';
import { ChevronsLeft, ChevronsRight, SkipBack, SkipForward, Play, Pause, StickyNote, Mic, Copy, X } from 'lucide-react';
import { Button } from '../ui/Button';

export type ActionType =
  | 'color'      // Payload: 'yellow' | 'green' | 'blue' | 'red'
  | 'note'       // Payload: string (the note text)
  | 'copy'       // Payload: null
  | 'pronounce'  // Payload: null
  | 'play'       // Payload: null
  | 'dismiss';   // Payload: null

interface CompassPillProps {
  variant: 'active' | 'summary' | 'compact' | 'annotation';
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
    queue,
    currentIndex,
    jumpTo,
    play,
    pause
  } = useTTSStore(useShallow(state => ({
      isPlaying: state.isPlaying,
      queue: state.queue,
      currentIndex: state.currentIndex,
      jumpTo: state.jumpTo,
      play: state.play,
      pause: state.pause
  })));

  // Internal state for note editing
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset editing state when variant changes
  useEffect(() => {
    setIsEditingNote(false);
    setNoteText('');
  }, [variant]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditingNote && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditingNote]);

  // Optimize: Select only currentChapterTitle to prevent re-renders on progress/cfi updates
  const readerChapterTitle = useReaderStore(state => state.currentChapterTitle);

  const { timeRemaining, progress: hookProgress } = useChapterDuration();

  const progress = overrideProgress !== undefined ? overrideProgress : hookProgress;

  // Helper for chapter navigation
  const handleChapterNav = (direction: 'prev' | 'next') => {
    // Simulate keyboard event for ReaderTTSController to pick up
    const key = direction === 'next' ? 'ArrowRight' : 'ArrowLeft';
    window.dispatchEvent(new KeyboardEvent('keydown', { key }));
  };

  const handleSkip = (direction: 'prev' | 'next') => {
      if (direction === 'next') {
          jumpTo(currentIndex + 1);
      } else {
          jumpTo(currentIndex - 1);
      }
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
  // Title priority: Queue Item Title -> Reader Store Title -> "Chapter X"
  const chapterTitle = currentItem?.title || readerChapterTitle || `Chapter ${currentIndex + 1}`;

  const displayTitle = title || currentItem?.bookTitle || "Current Book";
  const displaySubtitle = subtitle || chapterTitle;

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
              className={`w-6 h-6 rounded-full border border-border hover:scale-125 transition-transform`}
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
            onClick={() => onAnnotationAction?.('copy')}
            data-testid="popover-copy-button"
            aria-label="Copy text"
          >
            <Copy size={18} />
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
            className={`relative flex flex-col items-center justify-center w-full max-w-sm px-4 py-2 mx-auto overflow-hidden text-center transition-all border shadow-lg h-24 rounded-xl bg-background/80 backdrop-blur-md border-border ${onClick ? 'cursor-pointer hover:bg-background/90' : ''}`}
            onClick={onClick}
          >
              <div className="text-xs font-bold truncate w-full opacity-90">
                  {displayTitle}
              </div>
              <div className="text-xs font-medium truncate w-full opacity-80 my-1">
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
          <div data-testid="compass-pill-compact" className="relative z-40 flex items-center justify-center gap-3 w-auto h-10 px-4 mx-auto transition-all border shadow-lg rounded-full bg-background/80 backdrop-blur-md border-border">
                {/* Prev Button */}
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full text-primary hover:bg-primary/10 hover:text-primary"
                    onClick={() => isPlaying ? handleSkip('prev') : handleChapterNav('prev')}
                    aria-label="Previous"
                >
                    {isPlaying ? <SkipBack size={16} /> : <ChevronsLeft size={18} />}
                </Button>

                {/* Play/Pause Button */}
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full text-primary hover:bg-primary/10 hover:text-primary"
                    onClick={handleTogglePlay}
                    aria-label={isPlaying ? "Pause" : "Play"}
                >
                    {isPlaying ? <Pause size={20} className="fill-current" /> : <Play size={20} className="fill-current ml-0.5" />}
                </Button>

                {/* Next Button */}
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full text-primary hover:bg-primary/10 hover:text-primary"
                    onClick={() => isPlaying ? handleSkip('next') : handleChapterNav('next')}
                    aria-label="Next"
                >
                     {isPlaying ? <SkipForward size={16} /> : <ChevronsRight size={18} />}
                </Button>
          </div>
      );
  }

  // Active Mode
  return (
    <div data-testid="compass-pill-active" className="relative z-40 flex items-center justify-between w-full max-w-md h-14 px-4 mx-auto transition-all border shadow-lg rounded-full bg-background/80 backdrop-blur-md border-border">
        {/* Background Progress */}
        <div
            className="absolute inset-y-0 left-0 bg-primary/10 -z-10 transition-all duration-300"
            style={{ width: `${progress}%` }}
        />

        {/* Left Button */}
        <Button
            variant="ghost"
            className="h-11 w-11 rounded-full text-primary hover:bg-primary/10 hover:text-primary touch-manipulation"
            onClick={() => isPlaying ? handleSkip('prev') : handleChapterNav('prev')}
            aria-label={isPlaying ? "Skip to previous sentence" : "Previous chapter"}
        >
            {isPlaying ? <SkipBack size={20} /> : <ChevronsLeft size={24} />}
        </Button>

        {/* Center Info */}
        <div
            className="flex flex-col items-center justify-center flex-1 px-2 overflow-hidden cursor-pointer active:scale-95 transition-transform"
            onClick={handleTogglePlay}
            role="button"
            aria-label={isPlaying ? "Pause" : "Play"}
        >
             <div className="text-sm font-bold tracking-wide uppercase truncate w-full text-center">
                {chapterTitle}
             </div>
             <div className="text-xs font-mono text-muted-foreground">
                {formatTime(timeRemaining)}
             </div>
        </div>

        {/* Right Button */}
        <Button
            variant="ghost"
            className="h-11 w-11 rounded-full text-primary hover:bg-primary/10 hover:text-primary touch-manipulation"
            onClick={() => isPlaying ? handleSkip('next') : handleChapterNav('next')}
            aria-label={isPlaying ? "Skip to next sentence" : "Next chapter"}
        >
             {isPlaying ? <SkipForward size={20} /> : <ChevronsRight size={24} />}
        </Button>
    </div>
  );
};
