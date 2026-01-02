import React from 'react';
import { Play, Pause, Loader2 } from 'lucide-react';
import { useTTSStore } from '../../store/useTTSStore';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../lib/utils';

export const SatelliteFAB: React.FC = () => {
    const { isPlaying, status, play, pause } = useTTSStore(useShallow(state => ({
        // Select only necessary state to prevent re-renders on every TTS progress update (activeCfi changes)
        isPlaying: state.isPlaying,
        status: state.status,
        play: state.play,
        pause: state.pause
    })));

    const isLoading = status === 'loading';

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
                "hover:brightness-110",
                isLoading && "cursor-wait"
            )}
            onClick={handleToggle}
            aria-label={isLoading ? "Loading..." : (isPlaying ? "Pause" : "Play")}
        >
            {isLoading ? (
                <Loader2 className="w-6 h-6 animate-spin" />
            ) : isPlaying ? (
                <Pause className="w-6 h-6 fill-current" />
            ) : (
                <Play className="w-6 h-6 fill-current ml-1" />
            )}
        </button>
    );
};
