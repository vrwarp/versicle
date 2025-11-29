import React, { useEffect, useRef } from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { cn } from '../../lib/utils';

export const TTSQueue: React.FC = () => {
    const { queue, currentIndex, jumpTo } = useTTSStore();
    const activeRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (activeRef.current) {
            activeRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
            });
        }
    }, [currentIndex]); // Scroll when index changes

    if (queue.length === 0) {
        return <div className="p-4 text-center text-muted text-xs">No text available.</div>;
    }

    return (
        <div data-testid="tts-queue-container" className="flex flex-col gap-1 mt-4 border-t border-border pt-4">
            <h4 data-testid="tts-queue-header" className="text-xs font-bold text-muted mb-2 uppercase tracking-wide">Queue</h4>
            <div data-testid="tts-queue-list" className="flex flex-col gap-1 max-h-60 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-muted">
                {queue.map((item, index) => {
                    const isActive = index === currentIndex;
                    return (
                        <button
                            key={index}
                            data-testid={`tts-queue-item-${index}`}
                            ref={isActive ? activeRef : null}
                            onClick={() => jumpTo(index)}
                            className={cn(
                                "text-left text-xs p-2 rounded transition-colors duration-200 w-full",
                                isActive
                                    ? "bg-primary/10 text-primary border-l-2 border-primary"
                                    : "hover:bg-muted/10 text-secondary"
                            )}
                        >
                            <p className="line-clamp-2">{item.text}</p>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
