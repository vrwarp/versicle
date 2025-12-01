import React, { useEffect, useRef } from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { cn } from '../../lib/utils';

/**
 * Displays the current TTS playback queue.
 * Automatically scrolls to the active sentence being spoken.
 *
 * @returns A React component rendering the queue list.
 */
export const TTSQueue: React.FC = () => {
    const { queue, currentIndex, jumpTo } = useTTSStore();
    const activeRef = useRef<HTMLButtonElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const prevIndexRef = useRef<number | null>(null);

    // Reset previous index when queue changes (e.g. new chapter)
    useEffect(() => {
        prevIndexRef.current = null;
    }, [queue]);

    useEffect(() => {
        const container = containerRef.current;
        const currentEl = activeRef.current;

        if (!container || !currentEl) {
            // Even if refs are missing, we should update prevIndex if possible,
            // but without refs we can't do much.
            if (currentEl) prevIndexRef.current = currentIndex;
            return;
        }

        const lastIndex = prevIndexRef.current;
        let shouldScroll = false;

        // Check if element is visible in container
        const isElementInView = (el: HTMLElement) => {
            const elRect = el.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();

            // Check intersection
            return (
                elRect.bottom > containerRect.top &&
                elRect.top < containerRect.bottom
            );
        };

        // Always scroll if:
        // 1. First run after mount or queue change (lastIndex === null)
        // 2. We are at the start of the queue (currentIndex === 0) - handles chapter resets
        if (lastIndex === null || currentIndex === 0) {
            shouldScroll = true;
        } else {
            // Check visibility
            const currentVisible = isElementInView(currentEl);

            // Check previous element visibility
            let prevVisible = false;
            // We use the lastIndex to find the previous element
            // This works even if we jumped (e.g. 5 -> 10), checking if 5 was visible.
            const prevEl = container.querySelector(`[data-testid="tts-queue-item-${lastIndex}"]`) as HTMLElement;
            if (prevEl) {
                prevVisible = isElementInView(prevEl);
            }

            // Scroll if we are already following (current visible)
            // or if we were following the previous item (prev visible)
            if (currentVisible || prevVisible) {
                shouldScroll = true;
            }
        }

        if (shouldScroll) {
            currentEl.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
            });
        }

        prevIndexRef.current = currentIndex;

    }, [currentIndex]); // Scroll when index changes

    if (queue.length === 0) {
        return <div className="p-4 text-center text-muted-foreground text-sm">No text available.</div>;
    }

    return (
        <div data-testid="tts-queue-container" className="flex flex-col h-full p-4 gap-1">
            <h4 data-testid="tts-queue-header" className="text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wide">Queue</h4>
            <div
                data-testid="tts-queue-list"
                ref={containerRef}
                className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-muted"
            >
                {queue.map((item, index) => {
                    const isActive = index === currentIndex;
                    return (
                        <button
                            key={index}
                            data-testid={`tts-queue-item-${index}`}
                            ref={isActive ? activeRef : null}
                            onClick={() => jumpTo(index)}
                            className={cn(
                                "text-left text-sm p-2 rounded transition-all duration-200 w-full",
                                isActive
                                    ? "bg-primary/20 text-foreground border-l-4 border-primary font-medium shadow-sm"
                                    : "text-muted-foreground opacity-60 hover:opacity-100 hover:bg-muted/10"
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
