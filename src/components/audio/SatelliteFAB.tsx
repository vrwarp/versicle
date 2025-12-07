import React from 'react';
import { Play, Pause } from 'lucide-react';
import { useTTSStore } from '../../store/useTTSStore';

export const SatelliteFAB: React.FC = () => {
  const { isPlaying, play, pause, status } = useTTSStore();

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  // Determine Icon based on state
  // If loading, we still show pause if we treat it as playing, or a spinner?
  // Design says: 'playing' | 'loading' -> Pause Icon; 'paused' | 'stopped' -> Play Icon.
  const showPause = status === 'playing' || status === 'loading';

  return (
    <button
      onClick={handleToggle}
      className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary shadow-xl transition-transform active:scale-95 hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      style={{ zIndex: 50 }}
      aria-label={showPause ? "Pause" : "Play"}
    >
      {showPause ? (
        <Pause className="h-6 w-6 text-primary-foreground fill-current" />
      ) : (
        <Play className="h-6 w-6 text-primary-foreground fill-current ml-1" />
      )}
    </button>
  );
};
