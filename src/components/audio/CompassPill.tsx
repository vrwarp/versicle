import React from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { useReaderStore } from '../../store/useReaderStore';
import { useChapterDuration } from '../../hooks/useChapterDuration';
import { ChevronsLeft, ChevronsRight, SkipBack, SkipForward } from 'lucide-react';

interface CompassPillProps {
  variant: 'active' | 'summary';
}

export const CompassPill: React.FC<CompassPillProps> = ({ variant }) => {
  const {
    isPlaying,
    queue,
    currentIndex,
    jumpTo
  } = useTTSStore();

  const {
    currentChapterTitle: readerChapterTitle,
  } = useReaderStore();

  const { timeRemaining, progress } = useChapterDuration();

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

  // Format time remaining: -MM:SS
  const formatTime = (minutes: number) => {
    const m = Math.floor(minutes);
    const s = Math.floor((minutes - m) * 60);
    return `-${m}:${s.toString().padStart(2, '0')} remaining`;
  };

  const currentItem = queue[currentIndex];
  // Title priority: Queue Item Title -> Reader Store Title -> "Chapter X"
  const chapterTitle = currentItem?.title || readerChapterTitle || `Chapter ${currentIndex + 1}`;

  // Summary Mode
  if (variant === 'summary') {
      return (
          <div data-testid="compass-pill-summary" className="relative flex flex-col items-center justify-center w-full max-w-sm px-4 py-2 mx-auto overflow-hidden text-center transition-all border shadow-lg h-24 rounded-xl bg-background/80 backdrop-blur-md border-white/10">
              <div className="text-xs font-bold truncate w-full opacity-90">
                  {currentItem?.bookTitle || "Current Book"}
              </div>
              <div className="text-xs font-medium truncate w-full opacity-80 my-1">
                  {chapterTitle}
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

  // Active Mode
  return (
    <div data-testid="compass-pill-active" className="relative z-40 flex items-center justify-between w-full max-w-md h-14 px-4 mx-auto transition-all border shadow-lg rounded-full bg-background/80 backdrop-blur-md border-white/10">
        {/* Background Progress */}
        <div
            className="absolute inset-y-0 left-0 bg-primary/10 -z-10 transition-all duration-300"
            style={{ width: `${progress}%` }}
        />

        {/* Left Button */}
        <button
            className="p-2 text-primary hover:bg-primary/10 rounded-full transition-colors"
            onClick={() => isPlaying ? handleSkip('prev') : handleChapterNav('prev')}
        >
            {isPlaying ? <SkipBack size={20} /> : <ChevronsLeft size={24} />}
        </button>

        {/* Center Info */}
        <div className="flex flex-col items-center justify-center flex-1 px-2 overflow-hidden">
             <div className="text-sm font-bold tracking-wide uppercase truncate w-full text-center">
                {chapterTitle}
             </div>
             <div className="text-xs font-mono text-muted-foreground">
                {formatTime(timeRemaining)}
             </div>
        </div>

        {/* Right Button */}
        <button
            className="p-2 text-primary hover:bg-primary/10 rounded-full transition-colors"
            onClick={() => isPlaying ? handleSkip('next') : handleChapterNav('next')}
        >
             {isPlaying ? <SkipForward size={20} /> : <ChevronsRight size={24} />}
        </button>
    </div>
  );
};
