import React from 'react';
import { Play, Pause } from 'lucide-react';
import { useTTSStore } from '../../store/useTTSStore';
import { cn } from '../../lib/utils';

export const SatelliteFAB: React.FC = () => {
  const { isPlaying, play, pause } = useTTSStore();

  const togglePlayback = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  return (
    <button
      onClick={togglePlayback}
      className={cn(
        "pointer-events-auto flex items-center justify-center",
        "w-14 h-14 rounded-full",
        "bg-primary text-primary-foreground shadow-xl",
        "hover:bg-primary/90 active:scale-95 transition-all duration-200",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      )}
      aria-label={isPlaying ? "Pause" : "Play"}
    >
      {isPlaying ? (
        <Pause className="w-6 h-6 fill-current" />
      ) : (
        <Play className="w-6 h-6 fill-current ml-1" />
      )}
    </button>
  );
};
