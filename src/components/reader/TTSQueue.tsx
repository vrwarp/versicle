import React, { useEffect, useRef } from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { cn } from '../../lib/utils';

/**
 * Component to display the TTS playback queue.
 * Allows users to see upcoming sentences and jump to a specific segment.
 */
export const TTSQueue: React.FC = () => {
    const { queue, activeCfi, isPlaying, play, setQueueIndex } = useTTSStore();
    const activeRef = useRef<HTMLButtonElement>(null);

    // Scroll active item into view
    useEffect(() => {
        if (activeRef.current) {
            activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [activeCfi]);

    const handleItemClick = (index: number) => {
        setQueueIndex(index);
        // If not playing, start playing
        if (!isPlaying) {
            play();
        }
    };

    if (!queue || queue.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-48 text-muted p-4 text-center">
                <p className="mb-2 font-medium">No text to play</p>
                <p className="text-xs">
                    Sentences will appear here when a chapter is loaded.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="p-3 border-b border-border bg-surface sticky top-0 z-10">
                <h3 className="text-sm font-bold text-foreground">Playback Queue</h3>
                <p className="text-xs text-muted">{queue.length} segments</p>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {queue.map((item, index) => {
                    const isActive = item.cfi === activeCfi;

                    return (
                        <button
                            key={`${index}-${item.cfi}`}
                            ref={isActive ? activeRef : null}
                            onClick={() => handleItemClick(index)}
                            className={cn(
                                "w-full text-left text-xs p-2 rounded transition-colors duration-200 border border-transparent",
                                isActive
                                    ? "bg-primary/10 border-primary text-foreground font-medium"
                                    : "hover:bg-border text-secondary"
                            )}
                        >
                            <div className="flex gap-2">
                                <div className="mt-0.5 shrink-0 w-4">
                                    {isActive && (
                                        isPlaying
                                            ? <span className="animate-pulse text-primary">●</span>
                                            : <span className="text-muted">⏸</span>
                                    )}
                                </div>
                                <p className="line-clamp-2 leading-relaxed">
                                    {item.text}
                                </p>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
