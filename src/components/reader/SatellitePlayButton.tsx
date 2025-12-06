import React, { useRef } from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { Play, Pause, Square } from 'lucide-react';
import { cn } from '../../lib/utils';

export const SatellitePlayButton: React.FC = () => {
    const { isPlaying, play, pause, stop } = useTTSStore();
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isLongPress = useRef(false);

    const handlePointerDown = () => {
        isLongPress.current = false;
        timerRef.current = setTimeout(() => {
            isLongPress.current = true;
            stop();
            // Provide haptic feedback if available (not standard in web yet, but good practice)
            if (navigator.vibrate) navigator.vibrate(50);
        }, 800);
    };

    const handlePointerUp = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }

        if (!isLongPress.current) {
            if (isPlaying) {
                pause();
            } else {
                play();
            }
        }
    };

    const handlePointerLeave = () => {
         if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    return (
        <button
            className={cn(
                "fixed bottom-24 right-6 z-50",
                "w-14 h-14 rounded-full",
                "bg-primary text-primary-foreground",
                "shadow-xl flex items-center justify-center",
                "hover:brightness-110 active:scale-95 transition-all duration-200"
            )}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            aria-label={isPlaying ? "Pause (Long press to Stop)" : "Play (Long press to Stop)"}
        >
            {isPlaying ? (
                <Pause className="w-6 h-6 fill-current" />
            ) : (
                <Play className="w-6 h-6 fill-current ml-1" />
            )}
        </button>
    );
};
