import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTTSStore } from '../../store/useTTSStore';
import { useReaderStore } from '../../store/useReaderStore';
import { useChapterDuration } from '../../hooks/useChapterDuration';
import { cn } from '../../lib/utils';
import { useUIStore } from '../../store/useUIStore';

export const CompassPill: React.FC = () => {
  const { queue, currentIndex, jumpTo } = useTTSStore();
  const { currentChapterTitle } = useReaderStore();
  const setAudioPanelOpen = useUIStore((state) => state.setAudioPanelOpen);
  const remainingTime = useChapterDuration();

  if (!queue || queue.length === 0) return null;

  const currentItem = queue[currentIndex];
  // Prefer queue title (if reliable) or reader store title
  const displayTitle = currentItem?.title || currentChapterTitle || `Chapter ${currentIndex + 1}`;

  const progress = queue.length > 0 ? (currentIndex / queue.length) * 100 : 0;

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Jump back 1 sentence (or logic for previous chapter if at start)
    // For now, simple sentence navigation
    jumpTo(Math.max(0, currentIndex - 1));
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    jumpTo(Math.min(queue.length - 1, currentIndex + 1));
  };

  const handleOpenPanel = () => {
      setAudioPanelOpen(true);
  };

  return (
    <div
      className={cn(
        "pointer-events-auto relative flex items-center justify-between",
        "h-14 w-full max-w-sm px-4 mx-auto",
        "rounded-full border border-white/10",
        "bg-background/80 backdrop-blur-md shadow-lg",
        "transition-all duration-300 ease-out"
      )}
      onClick={handleOpenPanel}
    >
      {/* Ambient Progress Bar (Background) */}
      <div
        className="absolute left-0 top-0 bottom-0 bg-primary/10 transition-all duration-500 rounded-l-full"
        style={{ width: `${progress}%`, borderRadius: '9999px 0 0 9999px' }} // Clip to pill shape
      />
      {/* Ensure the progress bar doesn't overflow the rounded corners on the right if 100% */}
       <div
        className="absolute left-0 top-0 bottom-0 right-0 rounded-full overflow-hidden pointer-events-none"
      >
          <div
            className="h-full bg-primary/5 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
      </div>


      {/* Left Control */}
      <button
        onClick={handlePrev}
        className="z-10 p-2 text-muted-foreground hover:text-foreground active:scale-95 transition-transform"
        aria-label="Previous sentence"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      {/* Center Info */}
      <div className="z-10 flex flex-col items-center justify-center flex-1 overflow-hidden px-2 text-center cursor-pointer">
        <span className="text-xs font-semibold uppercase tracking-wider truncate w-full max-w-[200px]">
          {displayTitle}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">
          {remainingTime ? `-${remainingTime} remaining` : 'Thinking...'}
        </span>
      </div>

      {/* Right Control */}
      <button
        onClick={handleNext}
        className="z-10 p-2 text-muted-foreground hover:text-foreground active:scale-95 transition-transform"
        aria-label="Next sentence"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
};
