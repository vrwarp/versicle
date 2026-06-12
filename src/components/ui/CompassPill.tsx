import React, { useState, useEffect, useRef } from 'react';
import { useTTSStore } from '@store/useTTSStore';
import { useAudioCommands } from '@app/tts/useAudioCommands';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { useAnnotationStore } from '@store/useAnnotationStore';
import { useBookStore } from '@store/useBookStore';
import { useVocabularyStore } from '@store/useVocabularyStore';
import { useChineseDictionary } from '@hooks/useChineseDictionary';
import { useShallow } from 'zustand/react/shallow';
import { useSectionDuration } from '@hooks/useSectionDuration';
import { ChevronsLeft, ChevronsRight, Play, Pause, StickyNote, Mic, Copy, X, Loader2, Check, BookOpen, ArrowUpCircle, Smartphone, Trash2, GraduationCap } from 'lucide-react';
import { Button } from '../ui/Button';
import { cn } from '@lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

export type ActionType =
  | 'vocab'      // Payload: null
  | 'color'      // Payload: 'yellow' | 'green' | 'blue' | 'red'
  | 'note'       // Payload: string (the note text)
  | 'copy'       // Payload: null
  | 'pronounce'  // Payload: null
  | 'play'       // Payload: null
  | 'delete'     // Payload: null
  | 'dismiss';   // Payload: null

interface CompassPillProps {
  variant: 'active' | 'summary' | 'compact' | 'annotation' | 'sync-alert' | 'audio-triage' | 'vocab-triage';
  title?: string;
  subtitle?: string;
  progress?: number;
  onClick?: () => void;
  onAnnotationAction?: (action: ActionType, payload?: string) => void;
  availableActions?: {
    play?: boolean;
    pronounce?: boolean;
    delete?: boolean;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rendition?: any; // Pass rendition for triage operations
}

// Helper to identify adjacent compound words in the selection for lookup
const getCompoundWord = (fullText: string, charIndex: number, dict: Record<string, [string, string]> | null) => {
  if (!dict) return null;
  let longestWord = '';
  let longestDef = '';
  let longestPinyin = '';

  for (let start = Math.max(0, charIndex - 4); start <= charIndex; start++) {
    for (let end = charIndex + 1; end <= Math.min(fullText.length, charIndex + 5); end++) {
      const substring = fullText.substring(start, end);
      if (substring.length > 1 && dict[substring]) {
        if (substring.length > longestWord.length) {
          longestWord = substring;
          longestPinyin = dict[substring][0];
          longestDef = dict[substring][1];
        }
      }
    }
  }
  return longestWord ? { word: longestWord, pinyin: longestPinyin, definition: longestDef } : null;
};

// Interactive individual character tile component
const VocabTile: React.FC<{
  char: string;
  pinyin: string;
  definition: string;
  isKnown: boolean;
  onToggle: () => void;
  fullSelection: string;
  charIndex: number;
  dict: Record<string, [string, string]> | null;
}> = ({ char, pinyin, definition, isKnown, onToggle, fullSelection, charIndex, dict }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const tileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showTooltip) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (tileRef.current && !tileRef.current.contains(e.target as Node)) {
        setShowTooltip(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTooltip]);

  const compound = dict ? getCompoundWord(fullSelection, charIndex, dict) : null;

  return (
    <Popover open={showTooltip && (!!pinyin || !!definition)} onOpenChange={setShowTooltip}>
      <PopoverTrigger asChild>
        <div
          ref={tileRef}
          className="relative flex flex-col items-center"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          {/* Main Tile */}
          <button
            onClick={onToggle}
            className={cn(
              "relative flex flex-col items-center justify-center w-12 h-14 rounded-xl border transition-all duration-200 select-none",
              isKnown
                ? "bg-primary/10 border-primary text-primary font-medium shadow-sm hover:bg-primary/15"
                : "bg-card border-border text-foreground hover:bg-accent hover:border-accent-foreground/30"
            )}
            style={{ touchAction: 'manipulation' }}
          >
            <span className="text-[10px] text-muted-foreground/80 leading-none h-3 select-none font-pinyin">
              {pinyin.split(' / ')[0]}
            </span>
            <span className="text-lg font-semibold leading-none mt-1 select-none">
              {char}
            </span>

            {/* Small [i] icon for touch trigger */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowTooltip(!showTooltip);
              }}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-muted border border-border flex items-center justify-center text-[9px] text-muted-foreground hover:bg-accent hover:text-foreground shadow-sm transition-colors"
              title="Show meaning"
            >
              i
            </button>

            {isKnown && (
              <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
                <Check size={8} strokeWidth={3} />
              </div>
            )}
          </button>
        </div>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        className="w-48 bg-popover text-popover-foreground border border-border text-xs rounded-lg p-2.5 shadow-xl pointer-events-auto leading-relaxed z-[100]"
        style={{ textShadow: 'none' }}
      >
        <div className="font-semibold border-b border-border/40 pb-1 mb-1.5 flex items-center justify-between">
          <span className="text-sm">{char}</span>
          <span className="text-muted-foreground font-normal">[{pinyin}]</span>
        </div>
        <p className="text-muted-foreground break-words mb-1.5">{definition || 'No standalone definition'}</p>
        {compound && (
          <div className="border-t border-border/40 pt-1.5 mt-1.5 text-[10px]">
            <span className="font-semibold text-primary">In selection: </span>
            <span className="font-semibold">{compound.word}</span> <span className="text-muted-foreground">[{compound.pinyin}]</span>
            <p className="text-muted-foreground mt-0.5 break-words">{compound.definition}</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

export const CompassPill: React.FC<CompassPillProps> = ({
  variant,
  title,
  subtitle,
  progress: overrideProgress,
  onClick,
  onAnnotationAction,
  availableActions,
  rendition
}) => {
  const compassState = useReaderUIStore(state => state.compassState || {});
  const resetCompassState = useReaderUIStore(state => state.resetCompassState);
  const currentBookId = useReaderUIStore(state => state.currentBookId);
  const book = useBookStore(state => currentBookId ? state.books[currentBookId] : null);

  const {
    isPlaying,
    status,
    queue,
    currentIndex
  } = useTTSStore(useShallow(state => ({
    isPlaying: state.isPlaying,
    status: state.status,
    queue: state.queue,
    currentIndex: state.currentIndex
  })));

  // Engine commands come from the TtsController facade (stable identities).
  const { play, pause } = useAudioCommands();

  const { addAnnotation, removeAnnotation } = useAnnotationStore(useShallow(state => ({
      addAnnotation: state.add,
      removeAnnotation: state.remove
  })));

  // Popover state is ephemeral UI state (never synced via Yjs) — it lives in useReaderUIStore.
  const popover = useReaderUIStore(state => state.popover);

  const { knownCharacters, toggleKnownCharacter } = useVocabularyStore();
  const isChineseSelection = /[\u4e00-\u9fff]/.test(popover.text || '');
  const { dict } = useChineseDictionary(isChineseSelection);

  const isLoading = status === 'loading';

  // Internal state for note editing - initialize based on target annotation if present
  const [isEditingNote, setIsEditingNote] = useState(variant === 'annotation' && !!compassState.targetAnnotation?.note);
  const [noteText, setNoteText] = useState((variant === 'annotation' && compassState.targetAnnotation?.note) || '');
  const [isCopied, setIsCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Optimize: Select only currentSectionTitle to prevent re-renders on progress/cfi updates
  const readerSectionTitle = useReaderUIStore(state => state.currentSectionTitle);

  const { timeRemaining, progress: hookProgress } = useSectionDuration();

  // Keep track of previous variant and annotation to sync state during render
  // instead of using an effect, which prevents cascading renders.
  const [prevVariant, setPrevVariant] = useState(variant);
  const [prevAnnotationId, setPrevAnnotationId] = useState(compassState.targetAnnotation?.id);

  if (variant !== prevVariant || compassState.targetAnnotation?.id !== prevAnnotationId) {
    setPrevVariant(variant);
    setPrevAnnotationId(compassState.targetAnnotation?.id);
    if (variant === 'annotation' && compassState.targetAnnotation?.note) {
      setIsEditingNote(true);
      setNoteText(compassState.targetAnnotation.note);
    } else {
      setIsEditingNote(false);
      setNoteText('');
    }
  }

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

  // Audio Triage Mode
  if (variant === 'audio-triage' && compassState.targetAnnotation) {
      const onConfirmTriage = async () => {
          const target = compassState.targetAnnotation!;
          let newCfiRange = target.cfiRange;
          let newText = target.text;

          // If the user adjusted the selection, use the new bounds.
          // Otherwise, fall back to the original annotation data.
          if (rendition) {
              try {
                  const contents = rendition.manager?.getContents();
                  const currentSelection = contents?.[0]?.window?.getSelection();
                  if (currentSelection && currentSelection.rangeCount > 0 && currentSelection.toString().trim()) {
                      newCfiRange = new rendition.epubcfi().generateCfiFromRange(
                          currentSelection.getRangeAt(0),
                          contents[0].cfiBase
                      );
                      newText = currentSelection.toString();
                      currentSelection.removeAllRanges();
                  }
              } catch {
                  // Selection extraction failed; use original annotation data
              }
          }

          // Mutate CRDT Store: Delete dirty dragnet, insert precise highlight
          removeAnnotation(target.id);
          addAnnotation({
              ...target,
              cfiRange: newCfiRange,
              text: newText,
              type: 'highlight' // Elevate status
          });

          resetCompassState();
      };

      const onDiscardTriage = () => {
          removeAnnotation(compassState.targetAnnotation!.id);
          resetCompassState();
      };

      return (
          <div data-testid="compass-pill-triage" className="relative z-50 flex items-center justify-between w-full max-w-sm h-14 px-4 mx-auto overflow-hidden transition-all border shadow-lg rounded-full bg-background/90 backdrop-blur-md border-orange-500/50 animate-in fade-in slide-in-from-bottom-2">
              <span className="text-sm font-bold text-orange-500">Review Bookmark</span>
              <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={onDiscardTriage}>Discard</Button>
                      <Button variant="default" size="sm" onClick={onConfirmTriage}>Confirm</Button>
                  </div>
                  <div className="w-px h-6 bg-border mx-1" />
                  <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-full w-8 h-8 text-muted-foreground mr-[-4px]"
                      onClick={() => resetCompassState()}
                      aria-label="Dismiss review"
                  >
                      <X size={16} />
                  </Button>
              </div>
          </div>
      );
  }

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
  // Title priority: Subtitle Prop (real-time toggle) -> Queue Item Title -> Reader Store Title -> "Section X"
  const sectionTitle = subtitle || currentItem?.title || readerSectionTitle || `Section ${currentIndex + 1}`;

  const displayTitle = title || book?.title || "Current Book";
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
            className="w-full h-24 p-2 bg-transparent resize-none focus-visible:outline-none text-sm"
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
            onClick={() => {
              if (compassState.targetAnnotation?.note) {
                setNoteText(compassState.targetAnnotation.note);
              }
              setIsEditingNote(true);
            }}
            data-testid="popover-add-note-button"
            aria-label="Add Note"
          >
            <StickyNote size={18} />
          </Button>

          {/* Smart Pinyin Filtering Action */}
          {isChineseSelection && (
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full w-9 h-9 text-primary hover:bg-primary/10"
              onClick={() => {
                useReaderUIStore.getState().setCompassState({ variant: 'vocab-triage' });
              }}
              data-testid="popover-vocab-button"
              aria-label="Manage Pinyin Vocabulary"
              title="Mark as Known"
            >
              <GraduationCap size={18} />
            </Button>
          )}

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

          {availableActions?.delete && (
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full w-9 h-9 text-muted-foreground hover:text-destructive"
              onClick={() => onAnnotationAction?.('delete')}
              data-testid="popover-delete-button"
              aria-label="Delete"
            >
              <Trash2 size={18} />
            </Button>
          )}

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
            if (e.target !== e.currentTarget) return;
            e.preventDefault();
            onClick();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`Continue reading ${displayTitle}, ${displaySubtitle}, ${Math.round(progress)}% complete`}
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
        <div
          className="flex items-center gap-3 flex-1 min-w-0"
          onClick={onClick}
          role="button"
          tabIndex={0}
          aria-label={title && subtitle ? `${title}. ${subtitle}` : "Reading Progress Updated"}
          onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.target !== e.currentTarget) return;
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

  // Vocab Triage Mode
  if (variant === 'vocab-triage') {
    return (
      <div
        data-testid="compass-pill-vocab-triage"
        className="relative z-50 flex flex-col justify-between w-full max-w-md mx-auto transition-all duration-300 bg-background/95 backdrop-blur-md border border-border shadow-2xl rounded-2xl p-4 min-h-[160px]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/40 pb-2 mb-3">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <GraduationCap size={16} className="text-primary animate-pulse" />
            <span>Manage Pinyin annotations</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6 rounded-full hover:bg-muted"
            onClick={() => {
              useReaderUIStore.getState().resetCompassState();
              useReaderUIStore.getState().hidePopover();
            }}
            aria-label="Close"
          >
            <X size={14} />
          </Button>
        </div>

        {/* Subtitle instructions */}
        <p className="text-xs text-muted-foreground mb-3">
          Tap characters to toggle Pinyin. Pinyin will be hidden for checked words.
        </p>

        {/* Body: Tactile Character Tiles */}
        <div className="flex flex-wrap items-center gap-2 mb-4 justify-center max-h-[300px] overflow-y-auto p-1 custom-scrollbar">
          {Array.from(popover.text || '').map((char, index) => {
            const isChinese = /[\u4e00-\u9fff]/.test(char);
            
            if (!isChinese) {
              return (
                <span
                  key={`${char}-${index}`}
                  className="text-muted-foreground/60 text-lg font-mono px-1 flex items-center justify-center min-w-[20px] h-14 select-none"
                >
                  {char}
                </span>
              );
            }

            const isKnown = !!knownCharacters[char];
            const dictEntry = dict ? dict[char] : null;
            const pinyin = dictEntry ? dictEntry[0] : '';
            const definition = dictEntry ? dictEntry[1] : '';

            return (
              <VocabTile
                key={`${char}-${index}`}
                char={char}
                pinyin={pinyin}
                definition={definition}
                isKnown={isKnown}
                onToggle={() => toggleKnownCharacter(char)}
                fullSelection={popover.text}
                charIndex={index}
                dict={dict}
              />
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-1">
          <Button
            size="sm"
            className="px-4 py-1.5 h-8 text-xs rounded-full font-medium"
            onClick={() => {
              useReaderUIStore.getState().resetCompassState();
              useReaderUIStore.getState().hidePopover();
            }}
          >
            Done
          </Button>
        </div>
      </div>
    );
  }

  // Active Mode
  return (
    <div data-testid="compass-pill-active" className="relative z-40 flex items-center justify-between w-full max-w-md h-14 px-4 mx-auto overflow-hidden transition-all border shadow-lg rounded-full bg-background/75 backdrop-blur-md border-border">
      {/* Background Progress */}
      <div
        data-testid="compass-pill-progress-bar"
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
        aria-label="Next chapter"
      >
        <ChevronsRight size={24} />
      </Button>
    </div>
  );
};
