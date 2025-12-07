import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTTSStore } from '../../store/useTTSStore';
import { useReaderStore } from '../../store/useReaderStore';
import { useChapterDuration } from '../../hooks/useChapterDuration';

export const CompassPill: React.FC = () => {
  const {
    queue,
    currentIndex,
    jumpTo,
    // future: activeCfi
  } = useTTSStore();

  const { currentChapterTitle } = useReaderStore();
  const { chapterRemaining } = useChapterDuration();
  const minutesRemaining = chapterRemaining || 0;

  if (!queue || queue.length === 0) return null;

  const currentItem = queue[currentIndex];
  // Prefer title from queue item if available (it might be enriched), fallback to reader store
  const title = currentItem?.title || currentChapterTitle || `Chapter ${currentIndex + 1}`; // Fallback is weak, but better than nothing

  const progress = (currentIndex / (queue.length || 1)) * 100;

  const handlePrev = () => {
    // Logic: If > 3 seconds into current sentence, restart sentence?
    // Or just simple prev index for now as per spec
    // Spec says: "Single tap acts as 'Restart Chapter' command? No wait,"
    // Spec 2.3: "Left Anchor: ... Single tap acts as a 'Restart Chapter' command. A double-tap acts as a 'Previous Chapter' command."
    // Spec 3.2 (CompassPill): "Click Prev: player.prev() (or jumpTo(index - 1))"
    // The implementation plan simplified this to jumpTo(index - 1). I will stick to the simplified plan for now.
    if (currentIndex > 0) {
      jumpTo(currentIndex - 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < queue.length - 1) {
      jumpTo(currentIndex + 1);
    }
  };

  // Format time remaining
  const formatTime = (mins: number) => {
    const m = Math.floor(mins);
    const s = Math.floor((mins - m) * 60);
    return `-${m}:${s.toString().padStart(2, '0')} remaining`;
  };

  return (
    <div className="
      pointer-events-auto
      relative flex items-center justify-between
      w-full max-w-sm h-14
      mx-4 px-2
      rounded-full
      backdrop-blur-md bg-background/80 border border-white/10
      shadow-lg
      z-40
      overflow-hidden
    ">
      {/* Ambient Progress Bar Background */}
      <div
        className="absolute left-0 top-0 bottom-0 bg-primary/10 transition-all duration-500 ease-linear pointer-events-none"
        style={{ width: `${progress}%` }}
      />

      {/* Left Control */}
      <button
        onClick={handlePrev}
        disabled={currentIndex === 0}
        className="p-2 rounded-full hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent z-10 transition-colors"
      >
        <ChevronLeft className="w-5 h-5 text-foreground" />
      </button>

      {/* Center Narrative Box */}
      <div className="flex-1 flex flex-col items-center justify-center overflow-hidden px-2 z-10">
        <span className="text-xs font-medium text-foreground truncate w-full text-center">
          {title}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono mt-0.5">
          {formatTime(minutesRemaining)}
        </span>
      </div>

      {/* Right Control */}
      <button
        onClick={handleNext}
        disabled={currentIndex >= queue.length - 1}
        className="p-2 rounded-full hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent z-10 transition-colors"
      >
        <ChevronRight className="w-5 h-5 text-foreground" />
      </button>
    </div>
  );
};
