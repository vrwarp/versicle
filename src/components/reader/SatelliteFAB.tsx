import React from 'react';
import { Play, Pause, Loader2 } from 'lucide-react';
import { useTTSStore } from '../../store/useTTSStore';
import { cn } from '../../lib/utils';

interface SatelliteFABProps {
  className?: string;
}

export const SatelliteFAB: React.FC<SatelliteFABProps> = ({ className }) => {
  const { isPlaying, status, play, pause } = useTTSStore();

  const handleToggle = () => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  const isLoading = status === 'loading';

  return (
    <button
      data-testid="satellite-fab"
      onClick={handleToggle}
      className={cn(
        "relative flex items-center justify-center w-14 h-14 rounded-full",
        "bg-primary text-primary-foreground shadow-xl hover:bg-primary/90 hover:scale-105 active:scale-95",
        "transition-all duration-300 z-50",
        className
      )}
      aria-label={isPlaying ? "Pause" : "Play"}
    >
      {isLoading ? (
        <Loader2 className="w-6 h-6 animate-spin" />
      ) : isPlaying ? (
        <Pause className="w-6 h-6 fill-current" />
      ) : (
        <Play className="w-6 h-6 fill-current ml-1" />
      )}

      {/* Ripple/Glow Effect */}
      {isPlaying && (
        <div className="absolute inset-0 rounded-full animate-ping bg-primary/20 -z-10" />
      )}
    </button>
  );
};
