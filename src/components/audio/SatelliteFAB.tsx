import React from 'react';
import { Play, Pause } from 'lucide-react';
import { useTTSStore } from '../../store/useTTSStore';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../lib/utils';

export const SatelliteFAB: React.FC = () => {
    const { isPlaying, play, pause } = useTTSStore(useShallow(state => ({
        // Select only necessary state to prevent re-renders on every TTS progress update (activeCfi changes)
        isPlaying: state.isPlaying,
        play: state.play,
        pause: state.pause
    })));

    const handleToggle = () => {
        if (isPlaying) {
            pause();
        } else {
            play();
        }
    };

    return (
        <button
            data-testid="satellite-fab"
            className={cn(
                "flex items-center justify-center w-14 h-14 rounded-full shadow-xl bg-primary text-primary-foreground transition-transform active:scale-95 z-50",
                "hover:brightness-110"
            )}
            onClick={handleToggle}
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
