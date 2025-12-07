import React from 'react';
import { Play, Pause } from 'lucide-react';
import { useTTSStore } from '../../store/useTTSStore';

export const SatelliteFAB: React.FC = () => {
  const { isPlaying, play, pause } = useTTSStore();

  const handleToggle = () => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  return (
    <button
      onClick={handleToggle}
      className="
        pointer-events-auto
        flex items-center justify-center
        w-14 h-14
        rounded-full
        bg-primary text-primary-foreground
        shadow-xl
        hover:scale-105 active:scale-95
        transition-transform
        z-50
      "
      aria-label={isPlaying ? 'Pause' : 'Play'}
    >
      {isPlaying ? (
        <Pause className="w-6 h-6 fill-current" />
      ) : (
        <Play className="w-6 h-6 fill-current ml-1" />
      )}
    </button>
  );
};
