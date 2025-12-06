import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useReaderStore } from '../../store/useReaderStore';
import { useTTSStore } from '../../store/useTTSStore';
import { cn } from '../../lib/utils';

interface CompassPillProps {
  onPrev: () => void;
  onNext: () => void;
  className?: string;
}

export const CompassPill: React.FC<CompassPillProps> = ({ onPrev, onNext, className }) => {
  const { currentChapterTitle } = useReaderStore();
  const { queue, currentIndex } = useTTSStore();

  const hasQueue = queue.length > 0;
  const progressPercent = hasQueue
    ? Math.min(100, Math.max(0, ((currentIndex + 1) / queue.length) * 100))
    : 0;

  const remainingSentences = hasQueue ? queue.length - currentIndex : 0;
  const estimatedSeconds = remainingSentences * 4;
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `-${m}:${s.toString().padStart(2, '0')} remaining`;
  };

  const timeDisplay = hasQueue ? formatTime(estimatedSeconds) : 'Ready';

  return (
    <div
      data-testid="compass-pill"
      className={cn(
        "flex items-center gap-3 px-2 py-1.5 rounded-full",
        "bg-background/60 backdrop-blur-md border border-border/50 shadow-lg",
        "text-sm font-medium transition-all duration-300",
        className
      )}
    >
      <button
        data-testid="compass-prev-btn"
        onClick={onPrev}
        className="p-1.5 rounded-full hover:bg-foreground/10 text-muted-foreground transition-colors"
        aria-label="Previous Chapter"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <div className="flex flex-col items-center min-w-[120px]">
        <span className="text-xs font-semibold text-foreground truncate max-w-[150px]">
          {currentChapterTitle || 'Chapter'}
        </span>

        {/* Progress Bar & Time */}
        <div className="flex items-center gap-2 w-full mt-0.5">
          <div className="h-1 flex-1 bg-foreground/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
            {timeDisplay}
          </span>
        </div>
      </div>

      <button
        data-testid="compass-next-btn"
        onClick={onNext}
        className="p-1.5 rounded-full hover:bg-foreground/10 text-muted-foreground transition-colors"
        aria-label="Next Chapter"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
};
