import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTTSStore } from '../../store/useTTSStore';
import { useReaderStore } from '../../store/useReaderStore';
import { useChapterDuration } from '../../hooks/useChapterDuration';

export const CompassPill: React.FC = () => {
  const { queue, currentIndex, jumpTo } = useTTSStore();
  const { currentChapterTitle } = useReaderStore();
  const { formattedTime } = useChapterDuration();

  // If no queue, nothing to show (though parent container handles this mostly)
  if (!queue || queue.length === 0) return null;

  // Derived Values
  const currentItem = queue[currentIndex];

  // Use currentChapterTitle from ReaderStore as primary title source if available,
  // falling back to a generic name or extracting from queue if we had metadata there.
  // The design spec says: "Utilized to derive the nominal identifier (e.g., 'Advice from a Caterpillar')"
  // We use useReaderStore.currentChapterTitle for this.
  const displayTitle = currentChapterTitle || `Section ${currentIndex + 1}`;

  // Progress Calculation
  const progressPercent = queue.length > 0 ? ((currentIndex + 1) / queue.length) * 100 : 0;

  // Navigation Handlers
  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentIndex > 0) {
      jumpTo(currentIndex - 1);
    }
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentIndex < queue.length - 1) {
      jumpTo(currentIndex + 1);
    }
  };

  const handlePillClick = () => {
      // Placeholder for future expansion (UnifiedAudioPanel)
      console.log('Open Audio Panel');
  };

  // Check boundaries for disabling buttons
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === queue.length - 1;

  return (
    <div
        className="pointer-events-auto relative flex h-14 w-full max-w-sm items-center justify-between overflow-hidden rounded-full border border-white/10 bg-background/80 shadow-lg backdrop-blur-md transition-all active:scale-[0.98]"
        onClick={handlePillClick}
        style={{ zIndex: 40 }}
    >
      {/* Ambient Progress Bar */}
      <div
        className="absolute bottom-0 left-0 top-0 bg-primary/10 transition-all duration-500 ease-in-out"
        style={{ width: `${progressPercent}%` }}
      />

      {/* Left Anchor: Previous */}
      <button
        className={`z-10 flex h-full w-14 items-center justify-center text-foreground/70 transition-colors hover:text-foreground ${isFirst ? 'opacity-30 cursor-not-allowed' : ''}`}
        onClick={handlePrev}
        disabled={isFirst}
        aria-label="Previous Sentence"
      >
        <ChevronLeft size={24} />
      </button>

      {/* Center: Narrative Box */}
      <div className="z-10 flex flex-1 flex-col items-center justify-center overflow-hidden px-2 text-center">
        <span className="w-full truncate text-xs font-bold uppercase tracking-wider text-foreground">
          {displayTitle}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          -{formattedTime} remaining
        </span>
      </div>

      {/* Right Anchor: Next */}
      <button
        className={`z-10 flex h-full w-14 items-center justify-center text-foreground/70 transition-colors hover:text-foreground ${isLast ? 'opacity-30 cursor-not-allowed' : ''}`}
        onClick={handleNext}
        disabled={isLast}
        aria-label="Next Sentence"
      >
        <ChevronRight size={24} />
      </button>
    </div>
  );
};
